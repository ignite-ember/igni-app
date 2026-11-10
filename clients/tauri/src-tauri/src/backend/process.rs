//! A backend process this app spawned and therefore owns.

use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::backend::ready_line::ReadyLine;
use crate::backend::stderr_tail::StderrTail;
use crate::backend::{BackendVersionInfo, WsToken};
use crate::error::ShellError;
use crate::runtime::{self, ProgressFn};

/// How long the backend gets to wind down before it is forced. Teardown
/// (checkpointing the session pool, removing the lockfile) is normally
/// tens of milliseconds; this is headroom, not an expected wait.
pub(crate) const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

/// How long a dead backend's stderr gets to finish draining.
const STDERR_DRAIN_WAIT: Duration = Duration::from_millis(200);

const SHUTDOWN_POLL: Duration = Duration::from_millis(25);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ShutdownOutcome {
    /// Already dead — crashed, or killed by something else.
    AlreadyExited,
    /// Exited on its own after the terminate request.
    Graceful,
    /// Ignored the request (or there was none to send) and was killed.
    Forced,
}

pub(crate) struct BackendProcess {
    child: Child,
    port: u16,
    version: BackendVersionInfo,
}

impl BackendProcess {
    /// Spawn the backend and block until its ready line reports the WS
    /// port. `progress` receives short status strings during the
    /// (possibly multi-minute) first-launch bootstrap.
    pub fn spawn(
        project_dir: &str,
        token: Option<&WsToken>,
        progress: ProgressFn,
    ) -> Result<Self, ShellError> {
        progress("Preparing the igni backend…");
        let install = runtime::ensure_backend_python(progress)?;
        let version = BackendVersionInfo::from(&install);

        progress("Starting the igni backend…");
        let mut cmd = Command::new(&install.python);
        cmd.args([
            "-m",
            "igni_core.backend",
            "--ws-port",
            "0",
            "--project-dir",
            project_dir,
        ])
        .env("IGNI_PARENT_PID", std::process::id().to_string())
        .stdout(Stdio::piped())
        // Captured so a backend that dies during startup can say why.
        .stderr(Stdio::piped());
        for (k, v) in &install.env {
            cmd.env(k, v);
        }
        WsToken::apply(token, &mut cmd);
        let mut child = cmd.spawn().map_err(|source| ShellError::Spawn {
            python: install.python.clone(),
            source,
        })?;

        let stdout = child
            .stdout
            .take()
            .ok_or(ShellError::PipeUnavailable("stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or(ShellError::PipeUnavailable("stderr"))?;
        let tail = StderrTail::drain(stderr);

        let mut reader = BufReader::new(stdout);
        let port = Self::read_ready_port(&mut reader, &tail)?;
        Self::sink_stdout(reader);

        Ok(BackendProcess {
            child,
            port,
            version,
        })
    }

    /// Read stdout until the ready line; EOF first is a startup failure,
    /// reported with the last thing the backend said on stderr.
    fn read_ready_port(
        reader: &mut BufReader<ChildStdout>,
        tail: &StderrTail,
    ) -> Result<u16, ShellError> {
        let mut line = String::new();
        loop {
            line.clear();
            if reader
                .read_line(&mut line)
                .map_err(ShellError::StdoutRead)?
                == 0
            {
                tail.wait_for_drain(STDERR_DRAIN_WAIT);
                return Err(ShellError::BackendExited {
                    reason: tail.last_meaningful_line(),
                });
            }
            if let Some(port) = ReadyLine::parse(&line) {
                return Ok(port);
            }
        }
    }

    /// Keep draining stdout so the backend never blocks on a full pipe.
    fn sink_stdout(mut reader: BufReader<ChildStdout>) {
        thread::spawn(move || {
            let mut sink = String::new();
            while let Ok(n) = reader.read_line(&mut sink) {
                if n == 0 {
                    break;
                }
                sink.clear();
            }
        });
    }

    #[cfg(test)]
    pub fn adopt(child: Child, port: u16, version: BackendVersionInfo) -> Self {
        BackendProcess {
            child,
            port,
            version,
        }
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn version(&self) -> &BackendVersionInfo {
        &self.version
    }

    /// Stop the backend, giving it `grace` to exit cleanly.
    ///
    /// SIGTERM lets the backend drain its session pool and remove its
    /// discovery lockfile; `Child::kill` (SIGKILL) skips both and leaves a
    /// lockfile naming a dead PID. Escalates to a kill when `grace` lapses,
    /// so a wedged backend can never hold the app open.
    pub fn shutdown(&mut self, grace: Duration) -> ShutdownOutcome {
        if matches!(self.child.try_wait(), Ok(Some(_))) {
            return ShutdownOutcome::AlreadyExited;
        }
        if self.terminate() {
            let deadline = Instant::now() + grace;
            while Instant::now() < deadline {
                if matches!(self.child.try_wait(), Ok(Some(_))) {
                    return ShutdownOutcome::Graceful;
                }
                thread::sleep(SHUTDOWN_POLL);
            }
        }
        self.kill_now();
        ShutdownOutcome::Forced
    }

    /// Kill and reap without a grace period. A kill that fails means the
    /// process is already gone, which is the outcome wanted.
    pub fn kill_now(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    #[cfg(unix)]
    fn terminate(&self) -> bool {
        // SAFETY: `kill` with a PID this process spawned and has not reaped.
        unsafe { libc::kill(self.child.id() as i32, libc::SIGTERM) == 0 }
    }

    /// Nothing on Windows reaches a console-less child the way SIGTERM
    /// does; the backend's parent-PID watchdog is the cleanup there.
    #[cfg(not(unix))]
    fn terminate(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real child processes: the thing under test is whether a signal is
    // delivered and the child reaped, which a mock would only echo back.

    fn adopted(child: Child) -> BackendProcess {
        BackendProcess::adopt(
            child,
            1,
            BackendVersionInfo {
                actual: None,
                expected: "0".into(),
                source: "managed_venv",
            },
        )
    }

    #[cfg(unix)]
    #[test]
    fn a_cooperative_backend_exits_gracefully() {
        let mut backend = adopted(Command::new("sleep").arg("30").spawn().unwrap());
        let started = Instant::now();
        assert_eq!(
            backend.shutdown(Duration::from_secs(5)),
            ShutdownOutcome::Graceful
        );
        // Returns on the process being gone, not on the grace elapsing.
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[cfg(unix)]
    #[test]
    fn a_wedged_backend_is_forced() {
        let mut backend = adopted(
            Command::new("sh")
                .arg("-c")
                .arg("trap '' TERM; while :; do sleep 0.2; done")
                .spawn()
                .unwrap(),
        );
        // Guard the fixture: a shell that exited on its own would make
        // this report Graceful for the wrong reason.
        thread::sleep(Duration::from_millis(200));
        assert!(
            matches!(backend.child.try_wait(), Ok(None)),
            "fixture should still be running"
        );
        assert_eq!(
            backend.shutdown(Duration::from_millis(200)),
            ShutdownOutcome::Forced
        );
        assert!(
            matches!(backend.child.try_wait(), Ok(Some(_))),
            "reaped, not a zombie"
        );
    }

    #[cfg(unix)]
    #[test]
    fn an_already_dead_backend_is_reported_not_signalled() {
        let mut child = Command::new("true").spawn().unwrap();
        let _ = child.wait();
        assert_eq!(
            adopted(child).shutdown(Duration::from_millis(50)),
            ShutdownOutcome::AlreadyExited
        );
    }
}
