//! Which backend this app is using, and whether it is this app's to stop.

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::backend::{BackendConn, BackendProcess, BackendVersionInfo, WsToken, SHUTDOWN_GRACE};
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

/// Managed once in `setup`, before any window or bootstrap thread.
pub(crate) struct BackendSupervisor {
    slot: Mutex<BackendSlot>,
    conn: Mutex<Option<BackendConn>>,
    /// Counts the backends this app has spawned; a crash watcher holds the
    /// number of the one it watches, so it never acts on its successor.
    generation: Mutex<u64>,
    crashes: Mutex<CrashBudget>,
}

impl Default for BackendSupervisor {
    fn default() -> Self {
        BackendSupervisor {
            slot: Mutex::new(BackendSlot::Starting),
            conn: Mutex::new(None),
            generation: Mutex::new(0),
            crashes: Mutex::new(CrashBudget::default()),
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
            Decision::Spawn => {
                let token =
                    WsToken::for_spawn(std::env::var(WsToken::DEV_DISABLE_ENV).ok().as_deref())?;
                let process = BackendProcess::spawn(project_dir, token.as_ref(), progress)?;
                let conn = BackendConn::new(process.port(), token, process.version().clone());
                let mut slot = Self::lock(&self.slot);
                *Self::lock(&self.generation) += 1;
                *slot = BackendSlot::Owned(process);
                conn
            }
        };
        *Self::lock(&self.conn) = Some(conn.clone());
        Ok(conn)
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
