//! The shell's one answer to "which side is this app on, and how is it":
//! the state machine of the design's §4.2, as pure transitions.
//!
//! ```text
//! Local ──switch(cloud)──▶ Dialing ──upgraded──▶ Waking ──welcome──▶ CloudReady
//!   ▲                        │ 401 ─▶ NeedsDesktopSignIn                 │ ▲ vm_credential
//!   │                        │ net / 503 / 1013 / TLS                    ▼ │ needs_sign_in / ready
//!   │                        └──▶ CloudUnreachable(backoff) ◀──── CloudNeedsSignIn
//!   └── switch(local) / mode → local / 1008 refusal (when local is allowed)
//! ```
//!
//! [`BackendState::next`] is the whole table; the switchboard decides the
//! side effects around it.

use serde::Serialize;

/// Which side the app is on: this computer's backend, or the cloud.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Side {
    Local,
    Cloud,
}

/// Why the cloud cannot be reached right now. The token is what the
/// webview keys its banner on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Unreachable {
    /// DNS, TCP or a dropped connection, or the gateway answered 503.
    Network(String),
    /// 1013: the gateway is busy.
    Busy,
    /// 1011: the VM could not start (or did not answer in time).
    CouldNotStart(String),
    /// The gateway's certificate did not verify. Never bypassed in a
    /// release build.
    Certificate(String),
    /// The gateway's address was refused before any dial (not https, or
    /// not the pinned one), or there is none to dial.
    Gateway(String),
}

impl Unreachable {
    pub fn token(&self) -> &'static str {
        match self {
            Unreachable::Network(_) => "network",
            Unreachable::Busy => "busy",
            Unreachable::CouldNotStart(_) => "could_not_start",
            Unreachable::Certificate(_) => "certificate",
            Unreachable::Gateway(_) => "gateway",
        }
    }

    pub fn detail(&self) -> Option<&str> {
        match self {
            Unreachable::Network(d) | Unreachable::CouldNotStart(d) | Unreachable::Certificate(d) | Unreachable::Gateway(d) => {
                Some(d.as_str()).filter(|d| !d.is_empty())
            }
            Unreachable::Busy => None,
        }
    }
}

/// What igni in the VM said about its own credential (`vm_credential`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CredentialPush {
    Ready,
    NeedsSignIn,
    /// The VM cannot reach igni server; runs that need it fail on their own.
    Unreachable,
    /// An app VM's state; nobody signs in as an app on the desktop.
    NeedsReissue,
}

impl CredentialPush {
    pub fn parse(state: &str) -> Option<Self> {
        match state {
            "ready" => Some(CredentialPush::Ready),
            "needs_sign_in" => Some(CredentialPush::NeedsSignIn),
            "unreachable" => Some(CredentialPush::Unreachable),
            "needs_reissue" => Some(CredentialPush::NeedsReissue),
            _ => None,
        }
    }
}

/// One state of §4.2.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum BackendState {
    Local,
    Dialing,
    Waking,
    CloudReady { credential_unreachable: bool },
    CloudNeedsSignIn,
    NeedsDesktopSignIn,
    CloudUnreachable(Unreachable),
    Refused(String),
}

/// What moves the state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Event {
    SwitchCloud,
    SwitchLocal,
    /// The gateway accepted the upgrade; igni has not said `welcome` yet.
    Upgraded,
    /// igni's `welcome` reached a window (the first, or a resync's).
    Welcome,
    Credential(CredentialPush),
    /// The dial was answered 401.
    Unauthorized,
    Unreachable(Unreachable),
    /// 1008 with a reason other than the group moving to `local`.
    Refused(String),
    /// The desktop signed in again after [`BackendState::NeedsDesktopSignIn`].
    DesktopSignedIn,
    /// The person asked to try again now.
    Retry,
}

impl BackendState {
    /// The state after `event`. An event that means nothing in a state
    /// (a stale frame from a socket already being closed) leaves it.
    pub fn next(&self, event: &Event) -> BackendState {
        use BackendState as S;
        use Event as E;
        match (self, event) {
            (_, E::SwitchLocal) => S::Local,
            (S::Local | S::Refused(_), E::SwitchCloud) => S::Dialing,
            (_, E::SwitchCloud) => self.clone(),

            // Nothing from a cloud socket moves the local side.
            (S::Local, _) => S::Local,

            (S::Dialing | S::CloudUnreachable(_), E::Upgraded) => S::Waking,
            (_, E::Upgraded) => self.clone(),

            (S::Dialing | S::Waking | S::CloudUnreachable(_), E::Welcome) => S::CloudReady { credential_unreachable: false },
            (_, E::Welcome) => self.clone(),

            (S::Dialing | S::Waking | S::CloudReady { .. }, E::Credential(CredentialPush::NeedsSignIn)) => S::CloudNeedsSignIn,
            (S::Dialing | S::Waking | S::CloudReady { .. } | S::CloudNeedsSignIn, E::Credential(CredentialPush::Ready)) => {
                S::CloudReady { credential_unreachable: false }
            }
            (S::Dialing | S::Waking | S::CloudReady { .. } | S::CloudNeedsSignIn, E::Credential(CredentialPush::Unreachable)) => {
                S::CloudReady { credential_unreachable: true }
            }
            (_, E::Credential(_)) => self.clone(),

            (S::NeedsDesktopSignIn, E::DesktopSignedIn) => S::Dialing,
            (_, E::DesktopSignedIn) => self.clone(),
            (_, E::Unauthorized) => S::NeedsDesktopSignIn,

            (S::NeedsDesktopSignIn, E::Unreachable(_)) => self.clone(),
            (_, E::Unreachable(why)) => S::CloudUnreachable(why.clone()),

            (_, E::Refused(reason)) => S::Refused(reason.clone()),

            (S::CloudUnreachable(_) | S::Refused(_), E::Retry) => S::Dialing,
            (_, E::Retry) => self.clone(),
        }
    }

    /// The token the webview keys on.
    pub fn token(&self) -> &'static str {
        match self {
            BackendState::Local => "local",
            BackendState::Dialing => "dialing",
            BackendState::Waking => "waking",
            BackendState::CloudReady { .. } => "cloud_ready",
            BackendState::CloudNeedsSignIn => "cloud_needs_sign_in",
            BackendState::NeedsDesktopSignIn => "needs_desktop_sign_in",
            BackendState::CloudUnreachable(_) => "cloud_unreachable",
            BackendState::Refused(_) => "refused",
        }
    }

    /// The reason a banner names: an unreachable cause or a refusal.
    pub fn reason(&self) -> Option<String> {
        match self {
            BackendState::CloudUnreachable(why) => Some(why.token().to_string()),
            BackendState::Refused(reason) => Some(reason.clone()),
            _ => None,
        }
    }
}

/// The local runs and approvals still going on this computer while the
/// app is on the cloud: the badge on the switch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct LocalActivity {
    pub runs: u32,
    pub approvals: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use BackendState as S;
    use Event as E;

    fn net() -> Unreachable {
        Unreachable::Network("connection refused".into())
    }

    /// Every transition of §4.2's diagram and table, and the events each
    /// state ignores.
    #[test]
    fn the_transition_table() {
        let ready = S::CloudReady { credential_unreachable: false };
        let warned = S::CloudReady { credential_unreachable: true };
        let cases: Vec<(S, E, S)> = vec![
            (S::Local, E::SwitchCloud, S::Dialing),
            (S::Refused("inactive".into()), E::SwitchCloud, S::Dialing),
            (ready.clone(), E::SwitchCloud, ready.clone()),
            (S::Dialing, E::Upgraded, S::Waking),
            (S::CloudUnreachable(net()), E::Upgraded, S::Waking),
            (S::Waking, E::Welcome, ready.clone()),
            (S::Dialing, E::Welcome, ready.clone()),
            (S::CloudUnreachable(Unreachable::Busy), E::Welcome, ready.clone()),
            // A second welcome (the session moved nodes) keeps the state.
            (ready.clone(), E::Welcome, ready.clone()),
            (S::CloudNeedsSignIn, E::Welcome, S::CloudNeedsSignIn),
            (ready.clone(), E::Credential(CredentialPush::NeedsSignIn), S::CloudNeedsSignIn),
            (S::Waking, E::Credential(CredentialPush::NeedsSignIn), S::CloudNeedsSignIn),
            (S::CloudNeedsSignIn, E::Credential(CredentialPush::Ready), ready.clone()),
            (ready.clone(), E::Credential(CredentialPush::Unreachable), warned.clone()),
            (warned.clone(), E::Credential(CredentialPush::Ready), ready.clone()),
            (ready.clone(), E::Credential(CredentialPush::NeedsReissue), ready.clone()),
            (S::Dialing, E::Unauthorized, S::NeedsDesktopSignIn),
            (ready.clone(), E::Unauthorized, S::NeedsDesktopSignIn),
            (S::NeedsDesktopSignIn, E::DesktopSignedIn, S::Dialing),
            (S::NeedsDesktopSignIn, E::Unreachable(net()), S::NeedsDesktopSignIn),
            (S::Dialing, E::Unreachable(net()), S::CloudUnreachable(net())),
            (S::Waking, E::Unreachable(Unreachable::CouldNotStart("timed out".into())), S::CloudUnreachable(Unreachable::CouldNotStart("timed out".into()))),
            (S::Dialing, E::Unreachable(Unreachable::Busy), S::CloudUnreachable(Unreachable::Busy)),
            (S::Dialing, E::Unreachable(Unreachable::Certificate("bad".into())), S::CloudUnreachable(Unreachable::Certificate("bad".into()))),
            (ready.clone(), E::Unreachable(net()), S::CloudUnreachable(net())),
            (S::CloudNeedsSignIn, E::Unreachable(net()), S::CloudUnreachable(net())),
            (ready.clone(), E::Refused("inactive".into()), S::Refused("inactive".into())),
            (S::Dialing, E::Refused("licence".into()), S::Refused("licence".into())),
            (S::CloudUnreachable(net()), E::Retry, S::Dialing),
            (S::Refused("inactive".into()), E::Retry, S::Dialing),
            (ready.clone(), E::Retry, ready.clone()),
            (ready.clone(), E::SwitchLocal, S::Local),
            (S::CloudUnreachable(net()), E::SwitchLocal, S::Local),
            (S::NeedsDesktopSignIn, E::SwitchLocal, S::Local),
            (S::Refused("x".into()), E::SwitchLocal, S::Local),
            // The local side ignores every cloud socket's news.
            (S::Local, E::Upgraded, S::Local),
            (S::Local, E::Welcome, S::Local),
            (S::Local, E::Credential(CredentialPush::NeedsSignIn), S::Local),
            (S::Local, E::Unauthorized, S::Local),
            (S::Local, E::Unreachable(net()), S::Local),
            (S::Local, E::Refused("inactive".into()), S::Local),
            (S::Local, E::Retry, S::Local),
            (S::Local, E::DesktopSignedIn, S::Local),
        ];
        for (from, event, to) in cases {
            assert_eq!(from.next(&event), to, "{from:?} + {event:?}");
        }
    }

    #[test]
    fn tokens_and_reasons_for_the_webview() {
        assert_eq!(S::Local.token(), "local");
        assert_eq!(S::CloudReady { credential_unreachable: true }.token(), "cloud_ready");
        assert_eq!(S::CloudUnreachable(Unreachable::Busy).reason().as_deref(), Some("busy"));
        assert_eq!(S::CloudUnreachable(Unreachable::CouldNotStart("x".into())).reason().as_deref(), Some("could_not_start"));
        assert_eq!(S::CloudUnreachable(Unreachable::Certificate("x".into())).reason().as_deref(), Some("certificate"));
        assert_eq!(S::Refused("not_licensed".into()).reason().as_deref(), Some("not_licensed"));
        assert_eq!(S::Waking.reason(), None);
        assert_eq!(Unreachable::Busy.detail(), None);
        assert_eq!(Unreachable::Network(String::new()).detail(), None);
        assert_eq!(Unreachable::Gateway("pin".into()).detail(), Some("pin"));
    }

    #[test]
    fn credential_states_parse() {
        assert_eq!(CredentialPush::parse("ready"), Some(CredentialPush::Ready));
        assert_eq!(CredentialPush::parse("needs_sign_in"), Some(CredentialPush::NeedsSignIn));
        assert_eq!(CredentialPush::parse("unreachable"), Some(CredentialPush::Unreachable));
        assert_eq!(CredentialPush::parse("needs_reissue"), Some(CredentialPush::NeedsReissue));
        assert_eq!(CredentialPush::parse("other"), None);
    }
}
