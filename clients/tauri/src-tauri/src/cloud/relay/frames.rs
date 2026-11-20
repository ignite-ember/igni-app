//! The two frames the relay reads on their way to a window: igni's
//! `welcome`, and the `vm_credential` push. Everything is passed on
//! unchanged; reading is only for the shell's state.

use serde::Deserialize;

use crate::cloud::state::CredentialPush;

/// What a frame from the cloud igni means to the shell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Seen {
    Welcome,
    Credential(CredentialPush),
    Other,
}

#[derive(Deserialize)]
struct Frame {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    channel: String,
    #[serde(default)]
    payload: Option<CredentialPayload>,
}

#[derive(Deserialize)]
struct CredentialPayload {
    #[serde(default)]
    state: String,
}

/// Classify one text frame. Only frames that can be one of the two are
/// parsed, so a long stream of tokens costs a substring search each.
pub(crate) fn classify(text: &str) -> Seen {
    if !text.contains("\"welcome\"") && !text.contains("vm_credential") {
        return Seen::Other;
    }
    let Ok(frame) = serde_json::from_str::<Frame>(text) else {
        return Seen::Other;
    };
    match frame.kind.as_str() {
        "welcome" => Seen::Welcome,
        "push_notification" if frame.channel == "vm_credential" => frame
            .payload
            .and_then(|p| CredentialPush::parse(&p.state))
            .map(Seen::Credential)
            .unwrap_or(Seen::Other),
        _ => Seen::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn welcome_and_credential_pushes_are_recognised() {
        assert_eq!(classify(r#"{"type":"welcome","client_id":"c1"}"#), Seen::Welcome);
        assert_eq!(
            classify(r#"{"type":"push_notification","channel":"vm_credential","payload":{"state":"needs_sign_in","message":""}}"#),
            Seen::Credential(CredentialPush::NeedsSignIn)
        );
        assert_eq!(
            classify(r#"{"type":"push_notification","channel":"vm_credential","payload":{"state":"ready"}}"#),
            Seen::Credential(CredentialPush::Ready)
        );
    }

    #[test]
    fn everything_else_is_other() {
        assert_eq!(classify(r#"{"type":"stream_delta","text":"welcome"}"#), Seen::Other);
        assert_eq!(classify(r#"{"type":"stream_delta","text":"\"welcome\""}"#), Seen::Other);
        assert_eq!(classify(r#"{"type":"push_notification","channel":"other","payload":{"state":"ready"}}"#), Seen::Other);
        assert_eq!(classify(r#"{"type":"push_notification","channel":"vm_credential","payload":{"state":"odd"}}"#), Seen::Other);
        assert_eq!(classify(r#"{"type":"push_notification","channel":"vm_credential"}"#), Seen::Other);
        assert_eq!(classify("not json \"welcome\""), Seen::Other);
    }
}
