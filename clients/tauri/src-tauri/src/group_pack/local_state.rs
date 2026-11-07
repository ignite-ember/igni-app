//! What this machine says about the pack: who is signed in, and the newest
//! pack the backend already accepted.

use serde::Deserialize;

use super::jose::decode_json;

/// `~/.igni/credentials.json`, as much of it as names the person.
#[derive(Deserialize)]
struct Credentials {
    access_token: String,
}

/// The session token's claims, as much of them as names the person.
#[derive(Deserialize)]
struct SessionClaims {
    sub: String,
}

/// `sub` of the session token in a credentials file's text. Decoded, not
/// verified: it names whose pack may apply, and a pack for anybody else
/// would still need igni server's signature.
pub(crate) fn subject_from_credentials(text: &str) -> Option<String> {
    let creds: Credentials = serde_json::from_str(text).ok()?;
    let claims: SessionClaims = decode_json(creds.access_token.split('.').nth(1)?).ok()?;
    Some(claims.sub)
}

/// `group-policy/pack_state.json`, which the backend writes on applying a pack.
#[derive(Debug, Default, Deserialize)]
pub(crate) struct PackState {
    version: Option<i64>,
}

impl PackState {
    /// The version a pack must not be older than, from the file's text.
    pub(crate) fn min_version(text: &str) -> Option<i64> {
        serde_json::from_str::<PackState>(text).ok()?.version
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    #[test]
    fn the_subject_comes_from_the_session_token() {
        let body = URL_SAFE_NO_PAD.encode("{\"sub\":\"p1\"}");
        let creds = format!("{{\"access_token\": \"h.{body}.s\"}}");
        assert_eq!(subject_from_credentials(&creds).as_deref(), Some("p1"));
        assert_eq!(subject_from_credentials("{}"), None);
    }

    #[test]
    fn the_applied_version_comes_from_the_pack_state() {
        assert_eq!(PackState::min_version("{\"version\": 7}"), Some(7));
        assert_eq!(PackState::min_version("{}"), None);
        assert_eq!(PackState::min_version("nonsense"), None);
    }
}
