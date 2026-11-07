//! Which backend this app is using, and whether it is this app's to stop.

use std::sync::{Mutex, MutexGuard};

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

/// Managed once in `setup`, before any window or bootstrap thread.
pub(crate) struct BackendSupervisor {
    slot: Mutex<BackendSlot>,
    conn: Mutex<Option<BackendConn>>,
}

impl Default for BackendSupervisor {
    fn default() -> Self {
        BackendSupervisor {
            slot: Mutex::new(BackendSlot::Starting),
            conn: Mutex::new(None),
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
                *Self::lock(&self.slot) = BackendSlot::Owned(process);
                conn
            }
        };
        *Self::lock(&self.conn) = Some(conn.clone());
        Ok(conn)
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
        BackendSupervisor {
            slot: Mutex::new(slot),
            conn: Mutex::new(None),
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
    fn nothing_is_published_until_connect() {
        assert!(BackendSupervisor::default().current_conn().is_none());
    }
}
