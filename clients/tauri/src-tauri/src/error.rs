//! The shell's typed failures, and how they reach the web UI.
//!
//! A `#[tauri::command]` that returns `Err(ShellError)` sends the FE the
//! `Display` text as a bare string, which is the wire format the commands
//! had when they returned `Result<_, String>`. Some of these texts are
//! shown to the user verbatim (the reinstall refusal, the updater's off
//! reason), so every one is pinned by a test below.

use std::fmt;
use std::io;
use std::path::PathBuf;

use serde::{Serialize, Serializer};

#[derive(Debug)]
pub(crate) enum ShellError {
    /// A failure reported by `runtime/`, which still speaks `String`.
    Runtime(String),
    /// The backend interpreter could not be started at all.
    Spawn {
        python: PathBuf,
        source: io::Error,
    },
    /// A pipe the spawn asked for was not handed back.
    PipeUnavailable(&'static str),
    /// The backend closed stdout before printing its ready line.
    BackendExited {
        reason: String,
    },
    StdoutRead(io::Error),
    NoSecureRandom,
    /// Another client's backend runs this project on a different version.
    VersionRefused {
        running: String,
        ours: String,
    },
    /// Reinstall asked of a backend this app does not own.
    AttachedNotOwned,
    /// The update policy forbids the request; carries the policy's reason.
    UpdatesOff(String),
    NoUpdatePending,
    UpdateEndpointInvalid {
        endpoint: String,
        reason: String,
    },
    UpdateEndpointRefused {
        endpoint: String,
        source: tauri_plugin_updater::Error,
    },
    Updater(tauri_plugin_updater::Error),
    Window(tauri::Error),
}

impl fmt::Display for ShellError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ShellError::Runtime(message) => f.write_str(message),
            ShellError::Spawn { python, source } => {
                write!(
                    f,
                    "failed to spawn backend via `{}`: {source}",
                    python.display()
                )
            }
            ShellError::PipeUnavailable(pipe) => write!(f, "backend {pipe} unavailable"),
            ShellError::BackendExited { reason } => {
                write!(f, "backend exited before signalling ready: {reason}")
            }
            ShellError::StdoutRead(e) => write!(f, "backend stdout read failed: {e}"),
            ShellError::NoSecureRandom => {
                f.write_str("no secure random source for the WebSocket token")
            }
            ShellError::VersionRefused { running, ours } => write!(
                f,
                "Another igni backend is running for this project on version {running}, \
                 but this app is {ours}. Close the other client (or restart it on the \
                 matching version) and reopen igni."
            ),
            ShellError::AttachedNotOwned => f.write_str(
                "This window is attached to a backend started by another igni client, so it \
                 can't be reinstalled from here. Close the other client first, then reopen igni.",
            ),
            ShellError::UpdatesOff(reason) => f.write_str(reason),
            ShellError::NoUpdatePending => f.write_str("no update pending"),
            ShellError::UpdateEndpointInvalid { endpoint, reason } => {
                write!(
                    f,
                    "update_endpoint is not a valid URL ({endpoint}): {reason}"
                )
            }
            ShellError::UpdateEndpointRefused { endpoint, source } => {
                write!(f, "update_endpoint was refused ({endpoint}): {source}")
            }
            ShellError::Updater(e) => write!(f, "{e}"),
            ShellError::Window(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ShellError {}

/// Commands send the FE the message text, exactly as they did as strings.
impl Serialize for ShellError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<String> for ShellError {
    fn from(message: String) -> Self {
        ShellError::Runtime(message)
    }
}

impl From<tauri::Error> for ShellError {
    fn from(e: tauri::Error) -> Self {
        ShellError::Window(e)
    }
}

impl From<tauri_plugin_updater::Error> for ShellError {
    fn from(e: tauri_plugin_updater::Error) -> Self {
        ShellError::Updater(e)
    }
}

/// Report a failure nobody upstream can act on, instead of discarding it.
pub(crate) trait LogOnError {
    fn log_on_error(self, what: &str);
}

impl<T, E: fmt::Display> LogOnError for Result<T, E> {
    fn log_on_error(self, what: &str) {
        if let Err(e) = self {
            eprintln!("igni: {what} failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_reinstall_refusal_reads_as_before() {
        assert_eq!(
            ShellError::AttachedNotOwned.to_string(),
            "This window is attached to a backend started by another igni client, so it \
             can't be reinstalled from here. Close the other client first, then reopen igni."
        );
    }

    #[test]
    fn the_version_refusal_names_both_versions() {
        let e = ShellError::VersionRefused {
            running: "1.0.2".into(),
            ours: "1.0.3".into(),
        };
        assert_eq!(
            e.to_string(),
            "Another igni backend is running for this project on version 1.0.2, but this app \
             is 1.0.3. Close the other client (or restart it on the matching version) and \
             reopen igni."
        );
    }

    #[test]
    fn the_updater_off_reason_is_passed_through_untouched() {
        let reason = "update checks are disabled (update_check_ttl: 0)";
        assert_eq!(ShellError::UpdatesOff(reason.into()).to_string(), reason);
    }

    #[test]
    fn the_spawn_path_messages_read_as_before() {
        assert_eq!(
            ShellError::BackendExited {
                reason: "boom".into()
            }
            .to_string(),
            "backend exited before signalling ready: boom"
        );
        assert_eq!(
            ShellError::Spawn {
                python: PathBuf::from("/py"),
                source: io::Error::other("nope")
            }
            .to_string(),
            "failed to spawn backend via `/py`: nope"
        );
        assert_eq!(
            ShellError::StdoutRead(io::Error::other("eof")).to_string(),
            "backend stdout read failed: eof"
        );
        assert_eq!(
            ShellError::PipeUnavailable("stdout").to_string(),
            "backend stdout unavailable"
        );
        assert_eq!(
            ShellError::PipeUnavailable("stderr").to_string(),
            "backend stderr unavailable"
        );
        assert_eq!(
            ShellError::NoSecureRandom.to_string(),
            "no secure random source for the WebSocket token"
        );
    }

    #[test]
    fn the_update_messages_read_as_before() {
        assert_eq!(ShellError::NoUpdatePending.to_string(), "no update pending");
        assert_eq!(
            ShellError::UpdateEndpointInvalid {
                endpoint: "x".into(),
                reason: "relative URL without a base".into()
            }
            .to_string(),
            "update_endpoint is not a valid URL (x): relative URL without a base"
        );
    }

    #[test]
    fn a_runtime_string_is_its_own_message() {
        assert_eq!(
            ShellError::from("disk full".to_string()).to_string(),
            "disk full"
        );
    }

    #[test]
    fn it_serializes_as_the_bare_message() {
        let wire = serde_json::to_value(ShellError::NoUpdatePending).unwrap();
        assert_eq!(wire, serde_json::json!("no update pending"));
    }
}
