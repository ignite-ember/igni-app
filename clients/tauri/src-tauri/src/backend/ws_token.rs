//! The per-launch secret that makes a WebSocket connection igni's window.
//!
//! The backend's WebSocket is reachable by every local process and web
//! page, so each spawn gets a fresh token. The backend reads it from a
//! pipe on its stdin when its igni-core can (`IGNI_WS_TOKEN_FD=0`), else
//! from its environment, which every process of the same user can read
//! for the backend's whole life (`ps eww`, `/proc/<pid>/environ`); never
//! from argv, which `ps` shows. The webview gets it in the
//! URL fragment, which never reaches a server and survives reloads. The
//! web client offers it as the `igni-token.<token>` subprotocol and the
//! backend refuses connections without it
//! (`src/igni_core/transport/ws_auth.py`). It is never written to disk,
//! where the agent could read it: a lockfile carries a program token
//! instead, so a window that attaches runs sessions but answers no
//! approval request (docs/SECURITY.md §10).

use std::io::Write as _;
use std::process::{Child, Command, Stdio};

use base64::Engine as _;
use ring::rand::SecureRandom as _;

use crate::error::ShellError;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct WsToken(String);

/// How the token reaches the backend about to be spawned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TokenHandoff {
    /// One line on its stdin, named by `IGNI_WS_TOKEN_FD=0`.
    Pipe,
    /// `IGNI_WS_TOKEN` in its environment: what an igni-core older than
    /// [`TokenHandoff::PIPE_SINCE`] reads. Such a backend ignores the
    /// descriptor variable and mints a token of its own, which no window
    /// could then present, so it must not be handed a pipe.
    Env,
}

impl TokenHandoff {
    /// The first igni-core release that reads `IGNI_WS_TOKEN_FD`. igni-core
    /// 1.0.4 is released without it; the change lands in the release after.
    pub const PIPE_SINCE: (u64, u64, u64) = (1, 0, 5);

    /// The handoff the backend's igni-core understands, by the
    /// `igni_core.__version__` the interpreter reported. An unknown or
    /// unreadable version gets the environment variable, which every
    /// igni-core reads.
    pub fn for_core_version(version: Option<&str>) -> Self {
        match version.and_then(Self::release_of) {
            Some(release) if release >= Self::PIPE_SINCE => TokenHandoff::Pipe,
            _ => TokenHandoff::Env,
        }
    }

    /// `major.minor.patch` from a version such as `1.0.5`, `1.0.5rc1` or
    /// `1.1.0.dev2+local`; a missing patch reads as 0.
    fn release_of(version: &str) -> Option<(u64, u64, u64)> {
        let mut parts = version.trim().splitn(3, '.');
        let number = |part: Option<&str>| -> Option<u64> {
            let digits: String = part?.chars().take_while(char::is_ascii_digit).collect();
            digits.parse().ok()
        };
        let major = number(parts.next())?;
        let minor = number(parts.next())?;
        let patch = number(parts.next()).unwrap_or(0);
        Some((major, minor, patch))
    }
}

impl WsToken {
    /// The environment variable the backend reads its token from.
    pub const ENV: &'static str = "IGNI_WS_TOKEN";
    /// The variable naming the descriptor the backend reads its token
    /// from instead; `0` is stdin.
    pub const FD_ENV: &'static str = "IGNI_WS_TOKEN_FD";
    /// Development only: start the backend without a token.
    pub const DEV_DISABLE_ENV: &'static str = "IGNI_DEV_NO_WS_TOKEN";

    /// 32 random bytes, base64url without padding: 43 characters, all
    /// valid in a WebSocket subprotocol token.
    pub fn generate() -> Result<Self, ShellError> {
        let mut bytes = [0u8; 32];
        ring::rand::SystemRandom::new()
            .fill(&mut bytes)
            .map_err(|_| ShellError::NoSecureRandom)?;
        Ok(WsToken(
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes),
        ))
    }

    /// `IGNI_DEV_NO_WS_TOKEN=1`, honoured in debug builds only: a release
    /// build always protects its backend.
    pub fn disabled_for_dev(value: Option<&str>) -> bool {
        cfg!(debug_assertions) && value.map(str::trim) == Some("1")
    }

    /// The token for a backend about to be spawned, or `None` when a
    /// developer turned it off. `dev_env` is the value of
    /// [`WsToken::DEV_DISABLE_ENV`].
    pub fn for_spawn(dev_env: Option<&str>) -> Result<Option<Self>, ShellError> {
        if Self::disabled_for_dev(dev_env) {
            eprintln!(
                "WARNING: {}=1 — the igni backend's WebSocket accepts connections without a \
                 token. Any local process can drive it. Development only.",
                Self::DEV_DISABLE_ENV
            );
            return Ok(None);
        }
        Self::generate().map(Some)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Prepare `cmd` to hand `token` to the backend it will start.
    /// Called after every other env var, so nothing can override it; an
    /// inherited dev switch is stripped so it cannot turn the backend's
    /// check off behind the token's back. With [`TokenHandoff::Pipe`] the
    /// environment names stdin and carries no token: the token is written
    /// there by [`WsToken::hand_over`] once the child runs.
    pub fn apply(token: Option<&WsToken>, handoff: TokenHandoff, cmd: &mut Command) {
        match (token, handoff) {
            (Some(_), TokenHandoff::Pipe) => {
                cmd.env(Self::FD_ENV, "0")
                    .env_remove(Self::ENV)
                    .env_remove(Self::DEV_DISABLE_ENV)
                    .stdin(Stdio::piped());
            }
            (Some(token), TokenHandoff::Env) => {
                cmd.env(Self::ENV, token.as_str())
                    .env_remove(Self::FD_ENV)
                    .env_remove(Self::DEV_DISABLE_ENV);
            }
            (None, _) => {
                cmd.env_remove(Self::ENV).env_remove(Self::FD_ENV);
            }
        }
    }

    /// Write `token` and a newline to the stdin [`WsToken::apply`] piped,
    /// then close it, so the backend reads one line and nothing waits on
    /// the pipe. Nothing to do for the other handoffs. A write that fails
    /// means the backend already died: its ready-line read reports why.
    pub fn hand_over(token: Option<&WsToken>, handoff: TokenHandoff, child: &mut Child) {
        let (Some(token), TokenHandoff::Pipe) = (token, handoff) else {
            return;
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(format!("{}\n", token.as_str()).as_bytes());
            // Dropped here: the backend sees the line end, then EOF.
        }
    }
}

/// A program token read from a running backend's lockfile.
impl From<String> for WsToken {
    fn from(token: String) -> Self {
        WsToken(token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_launch_gets_a_fresh_urlsafe_token() {
        let a = WsToken::generate().unwrap();
        let b = WsToken::generate().unwrap();
        assert_ne!(a.as_str(), b.as_str());
        assert_eq!(a.as_str().len(), 43);
        assert!(a
            .as_str()
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
    }

    #[test]
    fn the_dev_switch_only_works_in_debug_builds() {
        assert_eq!(WsToken::disabled_for_dev(Some("1")), cfg!(debug_assertions));
        assert!(!WsToken::disabled_for_dev(Some("0")));
        assert!(!WsToken::disabled_for_dev(Some("yes")));
        assert!(!WsToken::disabled_for_dev(None));
    }

    fn env_of(cmd: &Command) -> Vec<(&std::ffi::OsStr, Option<&std::ffi::OsStr>)> {
        cmd.get_envs().collect()
    }

    #[test]
    fn an_older_core_gets_the_token_in_its_environment_and_the_dev_switch_stripped() {
        let mut cmd = Command::new("true");
        WsToken::apply(
            Some(&WsToken::from("abc".to_string())),
            TokenHandoff::Env,
            &mut cmd,
        );
        let envs = env_of(&cmd);
        assert!(envs.contains(&(WsToken::ENV.as_ref(), Some("abc".as_ref()))));
        assert!(envs.contains(&(WsToken::FD_ENV.as_ref(), None)));
        assert!(envs.contains(&(WsToken::DEV_DISABLE_ENV.as_ref(), None)));
    }

    #[test]
    fn a_core_that_reads_a_pipe_gets_stdin_named_and_no_token_in_its_environment() {
        let mut cmd = Command::new("true");
        WsToken::apply(
            Some(&WsToken::from("abc".to_string())),
            TokenHandoff::Pipe,
            &mut cmd,
        );
        let envs = env_of(&cmd);
        assert!(envs.contains(&(WsToken::FD_ENV.as_ref(), Some("0".as_ref()))));
        // Removed, so not even an inherited token reaches the child.
        assert!(envs.contains(&(WsToken::ENV.as_ref(), None)));
        assert!(envs.contains(&(WsToken::DEV_DISABLE_ENV.as_ref(), None)));
        assert!(!envs.iter().any(|(_, v)| *v == Some("abc".as_ref())));
    }

    #[test]
    fn no_token_removes_an_inherited_one() {
        for handoff in [TokenHandoff::Pipe, TokenHandoff::Env] {
            let mut cmd = Command::new("true");
            WsToken::apply(None, handoff, &mut cmd);
            assert_eq!(
                env_of(&cmd),
                vec![
                    (WsToken::ENV.as_ref(), None),
                    (WsToken::FD_ENV.as_ref(), None)
                ]
            );
        }
    }

    #[test]
    fn the_pipe_is_used_only_from_the_core_release_that_reads_it() {
        let pick = TokenHandoff::for_core_version;
        assert_eq!(pick(Some("1.0.5")), TokenHandoff::Pipe);
        assert_eq!(pick(Some("1.0.5rc1")), TokenHandoff::Pipe);
        assert_eq!(pick(Some("1.1.0.dev2+local")), TokenHandoff::Pipe);
        assert_eq!(pick(Some("2.0")), TokenHandoff::Pipe);
        assert_eq!(pick(Some("1.0.4")), TokenHandoff::Env);
        assert_eq!(pick(Some("1.0.3")), TokenHandoff::Env);
        assert_eq!(pick(Some("0.9.12")), TokenHandoff::Env);
        assert_eq!(pick(Some("unknown")), TokenHandoff::Env);
        assert_eq!(pick(Some("")), TokenHandoff::Env);
        assert_eq!(pick(None), TokenHandoff::Env);
    }

    // A real child: what is under test is the bytes the child reads on
    // its stdin and that the pipe is closed after them.
    #[cfg(unix)]
    #[test]
    fn the_pipe_carries_one_line_and_then_closes() {
        use std::io::Read as _;
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg("cat; echo \"fd=$IGNI_WS_TOKEN_FD env=${IGNI_WS_TOKEN:-none}\"")
            .env(WsToken::ENV, "inherited")
            // Without the pipe `cat` would read nothing, not hang.
            .stdin(Stdio::null())
            .stdout(Stdio::piped());
        let token = WsToken::from("tok-123".to_string());
        WsToken::apply(Some(&token), TokenHandoff::Pipe, &mut cmd);
        let mut child = cmd.spawn().unwrap();
        WsToken::hand_over(Some(&token), TokenHandoff::Pipe, &mut child);
        assert!(
            child.stdin.is_none(),
            "stdin is closed once the token is written"
        );
        let mut out = String::new();
        child
            .stdout
            .take()
            .unwrap()
            .read_to_string(&mut out)
            .unwrap();
        child.wait().unwrap();
        // `cat` returned, so the pipe reached EOF after the one line.
        assert_eq!(out, "tok-123\nfd=0 env=none\n");
    }

    #[cfg(unix)]
    #[test]
    fn nothing_is_written_when_the_token_rides_in_the_environment() {
        let mut cmd = Command::new("true");
        cmd.stdin(Stdio::piped());
        let token = WsToken::from("tok".to_string());
        let mut child = cmd.spawn().unwrap();
        WsToken::hand_over(Some(&token), TokenHandoff::Env, &mut child);
        assert!(child.stdin.is_some(), "an env handoff leaves stdin alone");
        child.wait().unwrap();
    }
}
