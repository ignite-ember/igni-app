//! The per-launch secret that makes a WebSocket connection igni's window.
//!
//! The backend's WebSocket is reachable by every local process and web
//! page, so each spawn gets a fresh token. The backend reads it from its
//! environment (never argv, which `ps` shows); the webview gets it in the
//! URL fragment, which never reaches a server and survives reloads. The
//! web client offers it as the `igni-token.<token>` subprotocol and the
//! backend refuses connections without it
//! (`src/igni_core/transport/ws_auth.py`). It is never written to disk,
//! where the agent could read it: a lockfile carries a program token
//! instead, so a window that attaches runs sessions but answers no
//! approval request (docs/SECURITY.md §10).

use std::process::Command;

use base64::Engine as _;
use ring::rand::SecureRandom as _;

use crate::error::ShellError;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct WsToken(String);

impl WsToken {
    /// The environment variable the backend reads its token from.
    pub const ENV: &'static str = "IGNI_WS_TOKEN";
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

    /// Hand `token` to the backend `cmd` will start. Called after every
    /// other env var, so nothing can override it; an inherited dev switch
    /// is stripped so it cannot turn the backend's check off behind the
    /// token's back.
    pub fn apply(token: Option<&WsToken>, cmd: &mut Command) {
        match token {
            Some(token) => {
                cmd.env(Self::ENV, token.as_str());
                cmd.env_remove(Self::DEV_DISABLE_ENV);
            }
            None => {
                cmd.env_remove(Self::ENV);
            }
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

    #[test]
    fn a_token_is_set_and_the_dev_switch_stripped() {
        let mut cmd = Command::new("true");
        WsToken::apply(Some(&WsToken::from("abc".to_string())), &mut cmd);
        let envs: Vec<_> = cmd.get_envs().collect();
        assert!(envs.contains(&(WsToken::ENV.as_ref(), Some("abc".as_ref()))));
        assert!(envs.contains(&(WsToken::DEV_DISABLE_ENV.as_ref(), None)));
    }

    #[test]
    fn no_token_removes_an_inherited_one() {
        let mut cmd = Command::new("true");
        WsToken::apply(None, &mut cmd);
        let envs: Vec<_> = cmd.get_envs().collect();
        assert_eq!(envs, vec![(WsToken::ENV.as_ref(), None)]);
    }
}
