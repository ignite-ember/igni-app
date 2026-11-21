//! What an upstream close means, and how the relay closes the window's
//! socket in turn.
//!
//! - Transient failures close the window with **1012** (service restart):
//!   the web client reconnects with its normal backoff and the relay
//!   re-dials.
//! - Final states close it with **1001**, after the shell has re-pointed
//!   or flagged the window.
//! - **1008 is never forwarded**: the web client reads 1008 as "replaced
//!   by another tab" and would stop reconnecting.

use crate::cloud::state::Unreachable;

/// Close codes the relay sends a window.
pub(crate) const CLOSE_RESTART: u16 = 1012;
pub(crate) const CLOSE_GOING_AWAY: u16 = 1001;

/// The gateway's 1008 reasons are a stable token followed by human text
/// (`group_local_only: …`); the token is what the shell acts on.
pub(crate) const GROUP_LOCAL_ONLY: &str = "group_local_only";
/// The 1008 the gateway sends when the token the socket was opened with
/// expires: the relay re-dials with the current one.
pub(crate) const TOKEN_EXPIRED: &str = "token_expired";

/// What the shell learns from an upstream close.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Upstream {
    /// Unreachable for now; retried with backoff.
    Unreachable(Unreachable),
    /// 1008 with a reason: not an active producer, kicked, a licence
    /// refusal, the group moved to `local`, the token expired.
    Refused(String),
    /// The VM's igni closed normally; the window reconnects.
    Ended,
}

/// The token of a 1008 reason: up to the first `:` or space.
pub(crate) fn reason_token(reason: &str) -> String {
    let token = reason.trim().split([':', ' ']).next().unwrap_or("").trim();
    if token.is_empty() {
        "refused".to_string()
    } else {
        token.to_string()
    }
}

/// Read an upstream close `code` with `reason`, and the code the window's
/// socket is closed with.
pub(crate) fn upstream_closed(code: u16, reason: &str) -> (Upstream, u16) {
    match code {
        1013 => (Upstream::Unreachable(Unreachable::Busy), CLOSE_RESTART),
        1011 => (Upstream::Unreachable(Unreachable::CouldNotStart(reason.trim().to_string())), CLOSE_RESTART),
        1008 if reason_token(reason) == TOKEN_EXPIRED => (Upstream::Ended, CLOSE_RESTART),
        1008 => (Upstream::Refused(reason_token(reason)), CLOSE_GOING_AWAY),
        1000 | 1001 => (Upstream::Ended, CLOSE_RESTART),
        _ => (Upstream::Unreachable(Unreachable::Network(format!("closed {code}"))), CLOSE_RESTART),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_close_code_maps_and_1008_never_reaches_the_window() {
        assert_eq!(upstream_closed(1013, ""), (Upstream::Unreachable(Unreachable::Busy), 1012));
        assert_eq!(
            upstream_closed(1011, " vm did not start "),
            (Upstream::Unreachable(Unreachable::CouldNotStart("vm did not start".into())), 1012)
        );
        assert_eq!(
            upstream_closed(1008, "group_local_only: your organisation runs igni on your computer"),
            (Upstream::Refused("group_local_only".into()), 1001)
        );
        assert_eq!(upstream_closed(1008, "inactive"), (Upstream::Refused("inactive".into()), 1001));
        assert_eq!(upstream_closed(1008, ""), (Upstream::Refused("refused".into()), 1001));
        // An expired token is not a refusal: the window reconnects and the
        // relay dials with the token on disk now.
        assert_eq!(upstream_closed(1008, "token_expired: the session token expired"), (Upstream::Ended, 1012));
        assert_eq!(upstream_closed(1000, ""), (Upstream::Ended, 1012));
        assert_eq!(upstream_closed(1001, ""), (Upstream::Ended, 1012));
        assert_eq!(
            upstream_closed(1006, ""),
            (Upstream::Unreachable(Unreachable::Network("closed 1006".into())), 1012)
        );
        for code in [1000, 1001, 1006, 1008, 1011, 1013, 4000] {
            assert_ne!(upstream_closed(code, "x").1, 1008, "{code}");
        }
    }

    #[test]
    fn the_reason_token_is_the_first_word() {
        assert_eq!(reason_token("licence: seats exhausted"), "licence");
        assert_eq!(reason_token("token_expired the token expired"), "token_expired");
        assert_eq!(reason_token("  inactive  "), "inactive");
    }
}
