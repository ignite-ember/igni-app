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
    /// Restart asked of a backend this app does not own.
    RestartNotOwned,
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
            ShellError::RestartNotOwned => f.write_str(
                "This window is attached to a backend started by another igni client, so it \
                 can't be restarted from here. Close the other client first, then reopen igni.",
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
                write!(
                    f,
                    "update_endpoint was refused ({endpoint}): {}",
                    CauseChain::new(source, CauseChain::UPDATE_SERVER)
                )
            }
            ShellError::Updater(e) => write!(f, "{}", CauseChain::new(e, CauseChain::UPDATE_SERVER)),
            ShellError::Window(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ShellError {}

/// An error with everything that caused it, on one line.
///
/// Many errors print only their top line: the updater's read "error
/// sending request for url (…)" for a certificate this computer refused,
/// exactly like a server that is down or a name that does not resolve.
/// The causes underneath follow it, and a certificate from an authority
/// the system does not trust says so in words, with what an administrator
/// does about it (F13). Every HTTPS client in the shell checks
/// certificates against the operating system's roots, so a company CA
/// installed there is trusted and one that is not is refused; the advice
/// names the server the caller was talking to.
pub(crate) struct CauseChain<'a> {
    error: &'a (dyn std::error::Error + 'static),
    advice: &'static str,
}

impl<'a> CauseChain<'a> {
    /// For a mirror that `update_endpoint` names, or the release host.
    pub const UPDATE_SERVER: &'static str =
        "The update server's certificate is not signed by an authority this computer trusts. \
         If it is your organisation's own certificate authority, add that CA to the operating \
         system's trust store: the updater checks certificates against the system's roots.";

    /// For a download from the public internet (uv's release), which a
    /// proxy that inspects TLS re-signs with its own CA.
    pub const DOWNLOAD: &'static str =
        "The download's certificate is not signed by an authority this computer trusts. \
         Behind a proxy that inspects TLS, add the proxy's certificate authority to the \
         operating system's trust store: igni checks certificates against the system's roots.";

    /// For igni server and the gateway.
    pub const IGNI_SERVER: &'static str =
        "igni server's certificate is not signed by an authority this computer trusts. \
         If it is your organisation's own certificate authority, add that CA to the operating \
         system's trust store: igni checks certificates against the system's roots.";

    pub fn new(error: &'a (dyn std::error::Error + 'static), advice: &'static str) -> Self {
        CauseChain { error, advice }
    }

    /// The error itself and every error under it, nearest first.
    fn chain(&self) -> impl Iterator<Item = &'a (dyn std::error::Error + 'static)> {
        std::iter::successors(Some(self.error), |e| e.source())
    }

    /// The TLS failure in the chain, if any.
    pub fn tls_error(&self) -> Option<&'a rustls::Error> {
        self.chain().find_map(Self::rustls_in)
    }

    /// `e` as rustls's error. An `io::Error` hides the error it wraps from
    /// `source()`, and the refusal arrives as one `io::Error` inside
    /// another (hyper-util's connector around tokio-rustls's), so each is
    /// opened in turn.
    fn rustls_in<'e>(e: &'e (dyn std::error::Error + 'static)) -> Option<&'e rustls::Error> {
        if let Some(tls) = e.downcast_ref::<rustls::Error>() {
            return Some(tls);
        }
        let inner = e.downcast_ref::<io::Error>()?.get_ref()?;
        Self::rustls_in(inner)
    }

    pub fn untrusted_issuer(&self) -> bool {
        matches!(
            self.tls_error(),
            Some(rustls::Error::InvalidCertificate(
                rustls::CertificateError::UnknownIssuer
            ))
        )
    }
}

impl fmt::Display for CauseChain<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut text = String::new();
        for e in self.chain() {
            let line = e.to_string();
            if text.is_empty() {
                text = line;
            } else if !text.contains(&line) {
                text.push_str(": ");
                text.push_str(&line);
            }
        }
        if self.untrusted_issuer() {
            text.push_str(". ");
            text.push_str(self.advice);
        }
        f.write_str(&text)
    }
}

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
    fn the_restart_refusal_says_restart() {
        assert_eq!(
            ShellError::RestartNotOwned.to_string(),
            "This window is attached to a backend started by another igni client, so it \
             can't be restarted from here. Close the other client first, then reopen igni."
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

    /// An error that prints one line and points at the next, as hyper's
    /// connect error sits between reqwest's and the TLS one.
    #[derive(Debug)]
    struct Layer {
        line: &'static str,
        source: Option<io::Error>,
    }

    impl fmt::Display for Layer {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(self.line)
        }
    }

    impl std::error::Error for Layer {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            self.source.as_ref().map(|e| e as _)
        }
    }

    /// The shape a refused certificate reaches the shell in (read off a
    /// real refusal): reqwest's line, hyper-util's connect error, then
    /// rustls's error inside an `io::Error` inside another.
    fn refused(tls: rustls::Error) -> tauri_plugin_updater::Error {
        let connect = Layer {
            line: "client error (Connect)",
            source: Some(io::Error::other(io::Error::new(io::ErrorKind::InvalidData, tls))),
        };
        let request = Layer {
            line: "error sending request for url (https://mirror.igni.test/latest.json)",
            source: Some(io::Error::other(connect)),
        };
        tauri_plugin_updater::Error::Io(io::Error::other(request))
    }

    #[test]
    fn an_untrusted_mirror_certificate_says_so_and_what_to_do() {
        let e = ShellError::Updater(refused(rustls::Error::InvalidCertificate(
            rustls::CertificateError::UnknownIssuer,
        )));
        assert_eq!(
            e.to_string(),
            format!(
                "error sending request for url (https://mirror.igni.test/latest.json): \
                 client error (Connect): invalid peer certificate: UnknownIssuer. {}",
                CauseChain::UPDATE_SERVER
            )
        );
    }

    #[test]
    fn another_certificate_failure_names_itself_without_the_ca_advice() {
        let e = ShellError::Updater(refused(rustls::Error::InvalidCertificate(
            rustls::CertificateError::NotValidForName,
        )));
        let text = e.to_string();
        assert!(text.ends_with("client error (Connect): invalid peer certificate: NotValidForName"), "{text}");
        assert!(!text.contains(CauseChain::UPDATE_SERVER), "{text}");
    }

    #[test]
    fn an_updater_error_with_no_cause_reads_as_before() {
        assert_eq!(
            ShellError::Updater(tauri_plugin_updater::Error::ReleaseNotFound).to_string(),
            "Could not fetch a valid release JSON from the remote"
        );
    }

    #[test]
    fn a_cause_already_in_the_message_is_not_repeated() {
        let inner = io::Error::other("connection refused");
        let outer = Layer { line: "connect: connection refused", source: Some(inner) };
        let e = ShellError::Updater(tauri_plugin_updater::Error::Io(io::Error::other(outer)));
        assert_eq!(e.to_string(), "connect: connection refused");
    }

    #[test]
    fn a_refused_endpoint_carries_the_causes_too() {
        let e = ShellError::UpdateEndpointRefused {
            endpoint: "https://mirror.igni.test/latest.json".into(),
            source: refused(rustls::Error::InvalidCertificate(
                rustls::CertificateError::UnknownIssuer,
            )),
        };
        let text = e.to_string();
        assert!(text.starts_with("update_endpoint was refused (https://mirror.igni.test/latest.json): error sending"), "{text}");
        assert!(text.ends_with(CauseChain::UPDATE_SERVER), "{text}");
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
