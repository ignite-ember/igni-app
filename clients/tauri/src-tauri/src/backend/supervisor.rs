//! Which backend this app is using, and whether it is this app's to stop.

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::backend::{BackendConn, BackendKind, BackendProcess, BackendVersionInfo, WsToken, SHUTDOWN_GRACE};
use crate::discovery::{self, Decision};
use crate::error::ShellError;
use crate::runtime::{self, ProgressFn};

/// Ownership of the backend. Only `Owned` is ever stopped by this app: a
/// backend another client started (an IDE plugin, say) outlives it.
enum BackendSlot {
    /// Bootstrap has not resolved, or failed before owning anything.
    Starting,
    /// A backend this app spawned.
    Owned(BackendProcess),
    /// A backend another client started for this project.
    Attached,
    /// The owned backend was killed for a reinstall.
    Released,
}

/// What a look at a spawned backend found, for the watcher that asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Liveness {
    /// Still running.
    Running,
    /// Exited without this app asking it to: it crashed or was killed.
    Exited,
    /// No longer the backend the watcher was started for: restarted,
    /// reinstalled, shut down, or attached to another client's.
    Replaced,
}

/// How many backends that died on their own are replaced before the app
/// stops trying: a backend that dies at every start would otherwise be
/// respawned for as long as the window is open.
#[derive(Debug, Default)]
pub(crate) struct CrashBudget {
    recent: Vec<Instant>,
}

impl CrashBudget {
    /// Replacements allowed within [`CrashBudget::WINDOW`].
    pub const LIMIT: usize = 3;
    pub const WINDOW: Duration = Duration::from_secs(300);

    /// Count a crash at `now`; `true` if it may still be replaced.
    pub fn spend(&mut self, now: Instant) -> bool {
        self.recent
            .retain(|at| now.saturating_duration_since(*at) < Self::WINDOW);
        if self.recent.len() >= Self::LIMIT {
            return false;
        }
        self.recent.push(now);
        true
    }
}

/// How long the next bootstrap waits for a stopped backend's port to
/// close before it looks for a backend to attach to.
pub(crate) const PORT_RELEASE_WAIT: Duration = Duration::from_secs(10);

/// Wait until nothing answers on `port`, at most `timeout`; `true` once
/// it is closed.
pub(crate) fn wait_port_closed(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !discovery::port_reachable(port) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Managed once in `setup`, before any window or bootstrap thread.
pub(crate) struct BackendSupervisor {
    slot: Mutex<BackendSlot>,
    conn: Mutex<Option<BackendConn>>,
    /// Counts the backends this app has spawned; a crash watcher holds the
    /// number of the one it watches, so it never acts on its successor.
    generation: Mutex<u64>,
    crashes: Mutex<CrashBudget>,
    /// The port of the backend this app last stopped or lost. Discovery
    /// must not find it still answering and attach to it.
    released_port: Mutex<Option<u16>>,
}

impl Default for BackendSupervisor {
    fn default() -> Self {
        BackendSupervisor {
            slot: Mutex::new(BackendSlot::Starting),
            conn: Mutex::new(None),
            generation: Mutex::new(0),
            crashes: Mutex::new(CrashBudget::default()),
            released_port: Mutex::new(None),
        }
    }
}

impl BackendSupervisor {
    /// Attach to the backend another client runs for `project_dir`, or
    /// spawn one, then publish the connection for every later window.
    ///
    /// Attaching rather than spawning a second backend over the same
    /// `state.db` is the point of `discovery.rs`; a backend on another
    /// wire version is refused, because mixing versions corrupts state.
    pub fn connect(
        &self,
        project_dir: &str,
        progress: ProgressFn,
    ) -> Result<BackendConn, ShellError> {
        self.await_released_port();
        let conn = match discovery::discover(project_dir, runtime::IGNI_CORE_VERSION) {
            Decision::Attach {
                port,
                wire_version,
                ws_token,
            } => {
                progress("Connecting to the running igni backend…");
                *Self::lock(&self.slot) = BackendSlot::Attached;
                BackendConn::new(
                    port,
                    ws_token.map(WsToken::from),
                    BackendVersionInfo::discovered(wire_version),
                )
            }
            Decision::Refuse { running } => {
                return Err(ShellError::VersionRefused {
                    running,
                    ours: runtime::IGNI_CORE_VERSION.to_string(),
                });
            }
            Decision::Spawn => self.spawn(project_dir, BackendKind::Full, progress)?,
        };
        *Self::lock(&self.conn) = Some(conn.clone());
        Ok(conn)
    }

    /// Spawn the account-only backend (`cloud` mode, §6.4). It is never
    /// attached to: it has no project, so no lockfile names it, and one
    /// app's account backend is nobody else's.
    pub fn connect_account_only(&self, progress: ProgressFn) -> Result<BackendConn, ShellError> {
        let conn = self.spawn("", BackendKind::AccountOnly, progress)?;
        *Self::lock(&self.conn) = Some(conn.clone());
        Ok(conn)
    }

    fn spawn(&self, project_dir: &str, kind: BackendKind, progress: ProgressFn) -> Result<BackendConn, ShellError> {
        let token = WsToken::for_spawn(std::env::var(WsToken::DEV_DISABLE_ENV).ok().as_deref())?;
        let process = BackendProcess::spawn(project_dir, kind, token.as_ref(), progress)?;
        let conn = BackendConn::new(process.port(), token, process.version().clone());
        let mut slot = Self::lock(&self.slot);
        *Self::lock(&self.generation) += 1;
        *slot = BackendSlot::Owned(process);
        Ok(conn)
    }

    /// Stop the backend this app owns, whichever it is, so the other kind
    /// can take its place (a live mode change, §6.6). Graceful, like a
    /// restart, so it runs off the main thread. A backend another client
    /// started is left alone and simply no longer used.
    pub fn release_for_mode_change(&self) {
        let slot = std::mem::replace(&mut *Self::lock(&self.slot), BackendSlot::Released);
        if let BackendSlot::Owned(mut process) = slot {
            process.shutdown(SHUTDOWN_GRACE);
            self.remember_released(&process);
        }
        *Self::lock(&self.conn) = None;
    }

    /// Wait for the backend this app just stopped to stop answering.
    ///
    /// On Windows a backend is stopped by killing the venv launcher this
    /// app spawned; the interpreter under it dies a moment later, when the
    /// launcher's job closes. Discovery cannot tell a dying backend from a
    /// live one there (it has no PID probe, only the port), so a restart
    /// that looked straight away found the old backend still answering,
    /// attached to it, and was left on a dead port when it went (R619,
    /// desktop proof run 44799523100). Runs on the bootstrap thread.
    fn await_released_port(&self) {
        let port = Self::lock(&self.released_port).take();
        if let Some(port) = port {
            if !wait_port_closed(port, PORT_RELEASE_WAIT) {
                eprintln!("igni: the stopped backend's port {port} is still answering");
            }
        }
    }

    fn remember_released(&self, process: &BackendProcess) {
        *Self::lock(&self.released_port) = Some(process.port());
    }

    /// The number of the backend this app spawned and now runs, for a
    /// crash watcher to hold; `None` when it runs none of its own.
    pub fn owned_generation(&self) -> Option<u64> {
        let slot = Self::lock(&self.slot);
        matches!(*slot, BackendSlot::Owned(_)).then(|| *Self::lock(&self.generation))
    }

    /// Whether backend number `generation` is still running.
    pub fn liveness(&self, generation: u64) -> Liveness {
        let mut slot = Self::lock(&self.slot);
        if *Self::lock(&self.generation) != generation {
            return Liveness::Replaced;
        }
        match &mut *slot {
            BackendSlot::Owned(process) => {
                if process.has_exited() {
                    Liveness::Exited
                } else {
                    Liveness::Running
                }
            }
            _ => Liveness::Replaced,
        }
    }

    /// Take backend number `generation`, which exited on its own, out of
    /// the slot so a fresh one can be spawned, and withdraw its connection.
    /// `false` when it is not that backend, or not dead: the watcher then
    /// does nothing, and whoever replaced it owns the new one.
    pub fn release_crashed(&self, generation: u64) -> bool {
        if self.liveness(generation) != Liveness::Exited {
            return false;
        }
        let mut slot = Self::lock(&self.slot);
        if *Self::lock(&self.generation) != generation || !matches!(*slot, BackendSlot::Owned(_)) {
            return false;
        }
        if let BackendSlot::Owned(process) = &*slot {
            self.remember_released(process);
        }
        *slot = BackendSlot::Released;
        *Self::lock(&self.conn) = None;
        true
    }

    /// Count a crash; `true` if the app may start another backend for it.
    pub fn spend_crash(&self, now: Instant) -> bool {
        Self::lock(&self.crashes).spend(now)
    }

    /// The connection bootstrap published, or `None` while it is starting.
    pub fn current_conn(&self) -> Option<BackendConn> {
        Self::lock(&self.conn).clone()
    }

    /// Kill the owned backend so its runtime can be reinstalled.
    ///
    /// Refused while starting or attached: killing another client's
    /// backend would take down its windows, and reinstalling around it
    /// would change nothing the user can see. Forced rather than graceful
    /// because this runs on the main thread, and the re-bootstrap's
    /// discovery clears the lockfile the kill leaves behind.
    pub fn release_for_reinstall(&self) -> Result<(), ShellError> {
        let mut slot = Self::lock(&self.slot);
        match &mut *slot {
            BackendSlot::Starting | BackendSlot::Attached => Err(ShellError::AttachedNotOwned),
            BackendSlot::Owned(process) => {
                process.kill_now();
                self.remember_released(process);
                *slot = BackendSlot::Released;
                Ok(())
            }
            BackendSlot::Released => Ok(()),
        }
    }

    /// Refuse a restart before stopping anything: only a backend this app
    /// spawned is its to restart. Called on the menu's thread so the
    /// refusal can be shown at once.
    pub fn check_restartable(&self) -> Result<(), ShellError> {
        match &*Self::lock(&self.slot) {
            BackendSlot::Starting | BackendSlot::Attached => Err(ShellError::RestartNotOwned),
            BackendSlot::Owned(_) | BackendSlot::Released => Ok(()),
        }
    }

    /// Stop the owned backend so a fresh one can be spawned (File ›
    /// Restart Backend). Graceful, so the backend drains its sessions and
    /// removes its lockfile, and run off the main thread for that reason.
    /// The published connection is withdrawn: a window opened meanwhile
    /// must not be pointed at the stopped backend's port.
    pub fn release_for_restart(&self) -> Result<(), ShellError> {
        self.check_restartable()?;
        let slot = std::mem::replace(&mut *Self::lock(&self.slot), BackendSlot::Released);
        if let BackendSlot::Owned(mut process) = slot {
            process.shutdown(SHUTDOWN_GRACE);
            self.remember_released(&process);
        }
        *Self::lock(&self.conn) = None;
        Ok(())
    }

    /// Stop the backend on app exit, but only one this app spawned.
    pub fn shutdown_on_exit(&self) {
        let slot = std::mem::replace(&mut *Self::lock(&self.slot), BackendSlot::Released);
        match slot {
            BackendSlot::Owned(mut process) => {
                process.shutdown(SHUTDOWN_GRACE);
            }
            other => *Self::lock(&self.slot) = other,
        }
    }

    /// A poisoned lock still holds a coherent slot; recover it rather than
    /// panic, which inside `RunEvent::Exit` would abort the app.
    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[cfg(test)]
    fn with_slot(slot: BackendSlot) -> Self {
        let generation = u64::from(matches!(slot, BackendSlot::Owned(_)));
        BackendSupervisor {
            slot: Mutex::new(slot),
            conn: Mutex::new(None),
            generation: Mutex::new(generation),
            crashes: Mutex::new(CrashBudget::default()),
            released_port: Mutex::new(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    fn owned_sleep() -> (BackendSupervisor, u32) {
        let child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        let version = BackendVersionInfo {
            actual: None,
            expected: "0".into(),
            source: "managed_venv",
        };
        (
            BackendSupervisor::with_slot(BackendSlot::Owned(BackendProcess::adopt(
                child, 1, version,
            ))),
            pid,
        )
    }

    fn is_released(s: &BackendSupervisor) -> bool {
        matches!(*BackendSupervisor::lock(&s.slot), BackendSlot::Released)
    }

    #[test]
    fn reinstall_before_bootstrap_resolves_is_refused() {
        let s = BackendSupervisor::default();
        let err = s.release_for_reinstall().unwrap_err();
        assert!(matches!(err, ShellError::AttachedNotOwned));
        assert!(err
            .to_string()
            .starts_with("This window is attached to a backend started by another igni client"));
    }

    #[test]
    fn reinstall_of_an_attached_backend_is_refused() {
        let s = BackendSupervisor::with_slot(BackendSlot::Attached);
        assert!(matches!(
            s.release_for_reinstall(),
            Err(ShellError::AttachedNotOwned)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn reinstall_kills_an_owned_backend() {
        let (s, pid) = owned_sleep();
        s.release_for_reinstall().unwrap();
        assert!(is_released(&s));
        assert!(
            !discovery::pid_alive(pid as i32),
            "the owned backend should be gone"
        );
    }

    #[test]
    fn a_second_reinstall_goes_ahead() {
        let s = BackendSupervisor::with_slot(BackendSlot::Released);
        assert!(s.release_for_reinstall().is_ok());
    }

    #[test]
    fn exit_never_touches_an_attached_backend() {
        let s = BackendSupervisor::with_slot(BackendSlot::Attached);
        s.shutdown_on_exit();
        assert!(matches!(
            *BackendSupervisor::lock(&s.slot),
            BackendSlot::Attached
        ));
    }

    #[cfg(unix)]
    #[test]
    fn exit_stops_an_owned_backend() {
        let (s, pid) = owned_sleep();
        s.shutdown_on_exit();
        assert!(is_released(&s));
        assert!(!discovery::pid_alive(pid as i32));
    }

    #[test]
    fn a_poisoned_slot_does_not_panic_on_exit() {
        let s = std::sync::Arc::new(BackendSupervisor::with_slot(BackendSlot::Attached));
        let poisoner = std::sync::Arc::clone(&s);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.slot.lock().unwrap();
            panic!("poison the slot");
        })
        .join();
        assert!(s.slot.is_poisoned());
        s.shutdown_on_exit();
        assert!(s.release_for_reinstall().is_err());
    }

    #[test]
    fn restart_of_an_attached_backend_is_refused() {
        let s = BackendSupervisor::with_slot(BackendSlot::Attached);
        let err = s.release_for_restart().unwrap_err();
        assert!(matches!(err, ShellError::RestartNotOwned));
        assert!(err
            .to_string()
            .starts_with("This window is attached to a backend started by another igni client"));
        assert!(matches!(
            *BackendSupervisor::lock(&s.slot),
            BackendSlot::Attached
        ));
    }

    #[test]
    fn restart_before_bootstrap_resolves_is_refused() {
        assert!(BackendSupervisor::default().check_restartable().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn restart_stops_the_owned_backend_and_withdraws_its_connection() {
        // Restart Backend used to close only the web UI's socket: the
        // backend kept its PID and the window sat on "Connecting to
        // backend…" (R619).
        let (s, pid) = owned_sleep();
        *BackendSupervisor::lock(&s.conn) = Some(BackendConn::new(
            1,
            None,
            BackendVersionInfo::discovered("0".into()),
        ));
        s.release_for_restart().unwrap();
        assert!(is_released(&s));
        assert!(
            !discovery::pid_alive(pid as i32),
            "the old backend should be gone"
        );
        assert!(s.current_conn().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn a_mode_change_stops_the_owned_backend_and_withdraws_its_connection() {
        let (s, pid) = owned_sleep();
        *BackendSupervisor::lock(&s.conn) = Some(BackendConn::new(1, None, BackendVersionInfo::discovered("0".into())));
        s.release_for_mode_change();
        assert!(is_released(&s));
        assert!(!discovery::pid_alive(pid as i32));
        assert!(s.current_conn().is_none());
    }

    #[test]
    fn a_mode_change_leaves_an_attached_backend_running() {
        let s = BackendSupervisor::with_slot(BackendSlot::Attached);
        s.release_for_mode_change();
        assert!(is_released(&s), "no longer used, though not stopped");
    }

    #[test]
    fn nothing_is_published_until_connect() {
        assert!(BackendSupervisor::default().current_conn().is_none());
    }

    fn owned(child: std::process::Child) -> BackendSupervisor {
        let version = BackendVersionInfo {
            actual: None,
            expected: "0".into(),
            source: "managed_venv",
        };
        BackendSupervisor::with_slot(BackendSlot::Owned(BackendProcess::adopt(child, 1, version)))
    }

    // R619: a backend that crashed was left in the slot as if it ran. The
    // window sat on "Connecting…" until someone chose Restart Backend.
    #[cfg(unix)]
    #[test]
    fn a_backend_that_dies_on_its_own_is_seen_and_released_for_a_new_one() {
        let s = owned(Command::new("sh").args(["-c", "exit 3"]).spawn().unwrap());
        *BackendSupervisor::lock(&s.conn) = Some(BackendConn::new(
            1,
            None,
            BackendVersionInfo::discovered("0".into()),
        ));
        let generation = s.owned_generation().expect("an owned backend has a number");
        let seen = (0..100).find_map(|_| {
            std::thread::sleep(Duration::from_millis(20));
            (s.liveness(generation) == Liveness::Exited).then_some(())
        });
        assert!(seen.is_some(), "the exit was never seen");
        assert!(s.release_crashed(generation));
        assert!(is_released(&s));
        assert!(
            s.current_conn().is_none(),
            "no window may be pointed at the dead port"
        );
        assert!(
            s.check_restartable().is_ok(),
            "the next bootstrap may spawn"
        );
        assert!(!s.release_crashed(generation), "released once only");
    }

    #[cfg(unix)]
    #[test]
    fn a_running_backend_is_not_released_as_crashed() {
        let (s, pid) = owned_sleep();
        let generation = s.owned_generation().unwrap();
        assert_eq!(s.liveness(generation), Liveness::Running);
        assert!(!s.release_crashed(generation));
        assert!(discovery::pid_alive(pid as i32));
        s.shutdown_on_exit();
    }

    #[cfg(unix)]
    #[test]
    fn a_watcher_stops_once_its_backend_was_restarted_or_shut_down() {
        let (s, _) = owned_sleep();
        let generation = s.owned_generation().unwrap();
        s.release_for_restart().unwrap();
        assert_eq!(s.liveness(generation), Liveness::Replaced);
        assert!(!s.release_crashed(generation));
    }

    #[cfg(unix)]
    #[test]
    fn a_watcher_never_acts_on_the_backend_that_replaced_its_own() {
        let (s, _) = owned_sleep();
        let old = s.owned_generation().unwrap();
        *BackendSupervisor::lock(&s.generation) += 1;
        assert_eq!(s.liveness(old), Liveness::Replaced);
        assert!(!s.release_crashed(old));
        s.shutdown_on_exit();
    }

    #[test]
    fn an_attached_backend_is_never_watched() {
        let s = BackendSupervisor::with_slot(BackendSlot::Attached);
        assert_eq!(s.owned_generation(), None);
        assert_eq!(s.liveness(0), Liveness::Replaced);
        assert!(!s.release_crashed(0));
    }

    /// A port that stops answering after `after`.
    fn port_closing_after(after: Duration) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let started = Instant::now();
            listener.set_nonblocking(true).unwrap();
            while started.elapsed() < after {
                let _ = listener.accept();
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        port
    }

    // R619 on Windows: the restart's discovery found the stopped backend
    // still answering and attached to it.
    #[test]
    fn the_next_bootstrap_waits_for_the_stopped_backend_s_port_to_close() {
        let port = port_closing_after(Duration::from_millis(600));
        assert!(discovery::port_reachable(port), "fixture is listening");
        let s = BackendSupervisor::default();
        *BackendSupervisor::lock(&s.released_port) = Some(port);
        let started = Instant::now();
        s.await_released_port();
        assert!(
            !discovery::port_reachable(port),
            "returned while the old port still answered"
        );
        assert!(
            started.elapsed() >= Duration::from_millis(400),
            "it did not wait"
        );
        assert!(
            BackendSupervisor::lock(&s.released_port).is_none(),
            "waited for once"
        );
    }

    #[test]
    fn a_port_that_never_closes_is_waited_for_only_so_long() {
        let port = port_closing_after(Duration::from_secs(30));
        let started = Instant::now();
        assert!(!wait_port_closed(port, Duration::from_millis(300)));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn a_restart_and_a_reinstall_remember_the_port_they_stopped() {
        let (s, _) = owned_sleep();
        s.release_for_restart().unwrap();
        assert_eq!(*BackendSupervisor::lock(&s.released_port), Some(1));
        let (s, _) = owned_sleep();
        s.release_for_reinstall().unwrap();
        assert_eq!(*BackendSupervisor::lock(&s.released_port), Some(1));
    }

    #[test]
    fn crashes_are_replaced_up_to_the_limit_and_again_once_the_window_passes() {
        let mut budget = CrashBudget::default();
        let start = Instant::now();
        for i in 0..CrashBudget::LIMIT {
            assert!(
                budget.spend(start + Duration::from_secs(i as u64)),
                "crash {i}"
            );
        }
        assert!(
            !budget.spend(start + Duration::from_secs(10)),
            "one too many"
        );
        assert!(budget.spend(start + CrashBudget::WINDOW + Duration::from_secs(1)));
    }
}

