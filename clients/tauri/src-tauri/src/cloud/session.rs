//! The desktop's own session, read from `~/.igni/credentials.json` each
//! time it is needed.
//!
//! The token is the person's 30-day session token (`token_use=session`).
//! It is what igni server's `/v1/me/cloud` and the Fleet gateway accept,
//! and it is the one secret this module handles. It is held in a type
//! with no `Display`, no `Serialize` and a `Debug` that prints nothing of
//! it, so no command result, event payload or log line can carry it by
//! accident; it leaves this process only as an `Authorization` header.
//! Nothing caches it beyond one request or one dial: a sign-in or a
//! sign-out takes effect on the next read.

use std::fmt;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::group_pack::decode_json;

/// The session token. Only [`SessionToken::bearer`] exposes it.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct SessionToken(String);

impl SessionToken {
    /// The `Authorization` header value.
    pub fn bearer(&self) -> String {
        format!("Bearer {}", self.0)
    }
}

impl fmt::Debug for SessionToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SessionToken(<redacted>)")
    }
}

/// `credentials.json`, as much of it as this shell reads.
#[derive(Deserialize)]
struct CredentialsFile {
    access_token: String,
}

/// The session token's claims that name the account. Decoded, not
/// verified: igni server and the gateway verify the token; these only
/// key the remembered choice and the per-backend storage.
#[derive(Deserialize)]
struct AccountClaims {
    #[serde(default)]
    iss: String,
    #[serde(default)]
    org: String,
    sub: String,
}

/// Who is signed in on this machine, and the token that proves it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Session {
    pub token: SessionToken,
    pub iss: String,
    pub org: String,
    pub sub: String,
}

impl Session {
    /// `~/.igni/credentials.json` under `home`.
    pub fn credentials_path(home: &Path) -> PathBuf {
        home.join(".igni/credentials.json")
    }

    /// The session in a credentials file's text, or `None` when nobody is
    /// signed in (no file, no token, a token that is not a JWT).
    pub fn from_text(text: &str) -> Option<Session> {
        let file: CredentialsFile = serde_json::from_str(text).ok()?;
        let token = file.access_token.trim();
        let claims: AccountClaims = decode_json(token.split('.').nth(1)?).ok()?;
        if claims.sub.is_empty() {
            return None;
        }
        Some(Session {
            token: SessionToken(token.to_string()),
            iss: claims.iss,
            org: claims.org,
            sub: claims.sub,
        })
    }

    /// Read the session under `home` now.
    pub fn read(home: &Path) -> Option<Session> {
        std::fs::read_to_string(Self::credentials_path(home))
            .ok()
            .and_then(|text| Self::from_text(&text))
    }

    /// The account this session belongs to: `iss|org|sub`, the key the
    /// remembered choice is kept under.
    pub fn account_key(&self) -> String {
        format!("{}|{}|{}", self.iss, self.org, self.sub)
    }
}

/// A digest of the credentials file, to notice a sign-in or sign-out
/// without keeping the token: SHA-256 of the file's bytes, or `None`
/// when there is no file.
pub(crate) fn credentials_fingerprint(home: &Path) -> Option<Vec<u8>> {
    let bytes = std::fs::read(Session::credentials_path(home)).ok()?;
    Some(ring::digest::digest(&ring::digest::SHA256, &bytes).as_ref().to_vec())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    /// A credentials file for `sub` in `org`, issued by `iss`, whose token
    /// ends in `secret`.
    pub(crate) fn credentials(iss: &str, org: &str, sub: &str, secret: &str) -> String {
        let body = URL_SAFE_NO_PAD.encode(
            serde_json::json!({"iss": iss, "org": org, "sub": sub, "token_use": "session"}).to_string(),
        );
        format!("{{\"access_token\": \"h.{body}.{secret}\"}}")
    }

    #[test]
    fn the_account_comes_from_the_token_claims() {
        let session = Session::from_text(&credentials("https://igni.example", "o1", "p1", "sig")).unwrap();
        assert_eq!(session.account_key(), "https://igni.example|o1|p1");
        assert!(session.token.bearer().starts_with("Bearer h."));
        assert!(session.token.bearer().ends_with(".sig"));
    }

    #[test]
    fn nobody_is_signed_in_without_a_usable_token() {
        assert_eq!(Session::from_text("{}"), None);
        assert_eq!(Session::from_text("not json"), None);
        assert_eq!(Session::from_text("{\"access_token\": \"opaque\"}"), None);
        let no_sub = URL_SAFE_NO_PAD.encode("{\"iss\":\"x\"}");
        assert_eq!(Session::from_text(&format!("{{\"access_token\": \"h.{no_sub}.s\"}}")), None);
    }

    #[test]
    fn the_token_never_prints() {
        let session = Session::from_text(&credentials("i", "o", "p", "TOPSECRET")).unwrap();
        let shown = format!("{session:?}");
        assert!(!shown.contains("TOPSECRET"), "{shown}");
        assert!(shown.contains("<redacted>"), "{shown}");
    }

    #[test]
    fn the_fingerprint_follows_the_file_and_holds_no_token() {
        let home = std::env::temp_dir().join(format!("igni-session-fp-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".igni")).unwrap();
        assert_eq!(credentials_fingerprint(&home), None);
        std::fs::write(Session::credentials_path(&home), credentials("i", "o", "p", "AAAA")).unwrap();
        let first = credentials_fingerprint(&home).unwrap();
        assert_eq!(first.len(), 32);
        std::fs::write(Session::credentials_path(&home), credentials("i", "o", "p", "BBBB")).unwrap();
        assert_ne!(credentials_fingerprint(&home).unwrap(), first);
        assert_eq!(Session::read(&home).unwrap().sub, "p");
        let _ = std::fs::remove_dir_all(&home);
    }
}
