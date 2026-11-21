//! The decisions around the state machine: what the shell does when the
//! person flips the switch, a dial fails, discovery answers, the group's
//! mode changes or the desktop signs in or out (§4, §6.6, §8).
//!
//! Pure: each input changes the board and returns the effects to run, in
//! order. The controller runs them (I/O, windows, processes) and
//! broadcasts [`Switchboard::snapshot`] after every input, so every
//! window renders the same state.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::discovery::{CloudDiscovery, DiscoveryError, EventsOwner, VmStatus};
use super::gateway::GatewayUrl;
use super::mode::{CloudAvailability, GroupMode, SidePolicy};
use super::relay::close::{Upstream, CLOSE_GOING_AWAY, CLOSE_RESTART, GROUP_LOCAL_ONLY};
use super::relay::dial::DialError;
use super::relay::RelayEvent;
use super::state::{BackendState, CredentialPush, Event, LocalActivity, Side};

/// How long a move to the cloud the organisation asked for waits for a
/// local run to end before it goes anyway (§6.6).
pub(crate) const CLOUD_MOVE_WAIT: Duration = Duration::from_secs(10 * 60);

/// Who is signed in, as the board needs it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Account {
    pub key: String,
    pub org: String,
    pub sub: String,
}

/// Where windows are pointed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowTarget {
    /// This computer's full backend.
    Local,
    /// The relay, so the cloud igni.
    Relay,
    /// This computer's backend (full or account-only), for the sign-in
    /// wall when the desktop's own session has ended.
    SignIn,
}

/// A side effect, run by the controller in the order given.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Effect {
    PointWindows(WindowTarget),
    /// `PUT /v1/me/cloud/events-owner`, best effort.
    PutEventsOwner(EventsOwner),
    Remember(Side),
    /// Close every relay connection with this code.
    CloseUpstreams(u16),
    RecheckDiscovery,
    /// Start a full local backend (leaving `cloud` mode).
    SpawnFullBackend,
    /// Stop the full local backend and start the account-only one
    /// (entering `cloud` mode).
    UseAccountOnlyBackend,
    /// Clear the relay's backoff and dial now.
    RetryNow,
    /// Stop every extension page origin (§15.4).
    StopPageOrigins,
    /// Label File › Restart/Reinstall Backend for the side.
    LabelMenu(Side),
}

/// A one-off message the windows show over the state's own banner.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum Notice {
    /// The organisation moved igni to the cloud; the switch waits for the
    /// local run to end.
    MovingToCloud { approvals: u32 },
    /// The move happened.
    MovedToCloud { after_wait: bool, approvals_dropped: u32 },
    /// The organisation now runs igni on this computer.
    MovedToLocal,
}

/// One window's local activity, as it reported it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct WindowActivity {
    pub session_id: String,
    pub runs: u32,
    pub approvals: u32,
}

/// What every window is sent (`igni-backend-state`, `backend_state()`).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct BackendSnapshot {
    pub side: Side,
    pub state: &'static str,
    pub reason: Option<String>,
    pub detail: Option<String>,
    pub credential_warning: bool,
    pub mode: GroupMode,
    pub cloud: &'static str,
    pub cloud_reason: Option<String>,
    pub switch_visible: bool,
    pub chip_visible: bool,
    pub can_use_local: bool,
    pub can_use_cloud: bool,
    pub backend_key: String,
    pub local_activity: LocalActivity,
    pub notice: Option<Notice>,
    pub vm: Option<VmStatus>,
    pub group_name: Option<String>,
    pub retry_in_ms: Option<u64>,
}

/// The board.
#[derive(Clone, Debug)]
pub(crate) struct Switchboard {
    pub side: Side,
    pub state: BackendState,
    pub policy: SidePolicy,
    pub gateway: Option<GatewayUrl>,
    pub account: Option<Account>,
    /// Whether this computer runs the full backend (not the account-only
    /// one).
    pub full_backend: bool,
    pub activity: BTreeMap<String, WindowActivity>,
    pub notice: Option<Notice>,
    pub vm: Option<VmStatus>,
    pub group_name: Option<String>,
    /// A remembered cloud choice waiting for discovery to allow it.
    pub want_cloud: bool,
    /// When a move to the cloud the organisation asked for started waiting.
    pub cloud_move_since: Option<Instant>,
    allow_insecure: bool,
    gateway_pin: Option<String>,
}

impl Switchboard {
    /// The board at launch, before discovery. `remembered` is this
    /// account's last side and the gateway it knew.
    pub fn launch(
        pack_mode: GroupMode,
        account: Option<Account>,
        remembered: Option<(Side, Option<String>)>,
        allow_insecure: bool,
        gateway_pin: Option<String>,
    ) -> Self {
        let cloud_mode = pack_mode == GroupMode::Cloud && account.is_some();
        let (remembered_side, remembered_gateway) = remembered.unwrap_or((Side::Local, None));
        let gateway = remembered_gateway
            .and_then(|u| GatewayUrl::parse(&u, allow_insecure).ok())
            .filter(|g| g.check_pin(gateway_pin.as_deref()).is_ok());
        Switchboard {
            side: if cloud_mode { Side::Cloud } else { Side::Local },
            state: if cloud_mode { BackendState::Dialing } else { BackendState::Local },
            policy: SidePolicy { mode: pack_mode, availability: CloudAvailability::Unknown },
            gateway,
            account,
            full_backend: !cloud_mode,
            activity: BTreeMap::new(),
            notice: None,
            vm: None,
            group_name: None,
            want_cloud: !cloud_mode && remembered_side == Side::Cloud,
            cloud_move_since: None,
            allow_insecure,
            gateway_pin,
        }
    }

    /// Where windows go now.
    pub fn target(&self) -> WindowTarget {
        match (&self.side, &self.state) {
            (Side::Cloud, BackendState::NeedsDesktopSignIn) => WindowTarget::SignIn,
            (Side::Cloud, _) => WindowTarget::Relay,
            (Side::Local, _) => WindowTarget::Local,
        }
    }

    /// The storage key windows use for their client state (§4.4).
    pub fn backend_key(&self) -> String {
        match (self.target(), &self.gateway, &self.account) {
            (WindowTarget::Relay, Some(gw), Some(a)) => gw.backend_key(&a.org, &a.sub),
            (WindowTarget::Relay, _, _) => "cloud".to_string(),
            _ => "local".to_string(),
        }
    }

    pub fn local_activity(&self) -> LocalActivity {
        self.activity.values().fold(LocalActivity::default(), |sum, w| LocalActivity {
            runs: sum.runs + w.runs,
            approvals: sum.approvals + w.approvals,
        })
    }

    /// Whether a switch to `side` may be made now, and if not, why.
    pub fn may_switch(&self, side: Side) -> Result<(), String> {
        match side {
            Side::Local if !self.policy.may_use_local() => Err("Your organisation runs igni for you in the cloud.".into()),
            Side::Cloud if self.policy.mode == GroupMode::Local => Err("Your organisation runs igni on this computer.".into()),
            Side::Cloud if !self.policy.may_use_cloud() => Err("There is no cloud igni for you to use.".into()),
            Side::Cloud if self.account.is_none() => Err("Sign in on this computer first.".into()),
            _ => Ok(()),
        }
    }

    pub fn snapshot(&self) -> BackendSnapshot {
        let (cloud, cloud_reason) = match &self.policy.availability {
            CloudAvailability::Unknown => ("unknown", None),
            CloudAvailability::Available => ("available", None),
            CloudAvailability::Unavailable(reason) => ("unavailable", Some(reason.clone())),
        };
        let detail = match &self.state {
            BackendState::CloudUnreachable(why) => why.detail().map(str::to_string),
            _ => None,
        };
        BackendSnapshot {
            side: self.side,
            state: self.state.token(),
            reason: self.state.reason(),
            detail,
            credential_warning: matches!(self.state, BackendState::CloudReady { credential_unreachable: true }),
            mode: self.policy.mode,
            cloud,
            cloud_reason,
            switch_visible: self.policy.switch_visible(),
            chip_visible: self.policy.chip_visible() || self.side == Side::Cloud,
            can_use_local: self.policy.may_use_local(),
            can_use_cloud: self.policy.may_use_cloud(),
            backend_key: self.backend_key(),
            local_activity: if self.side == Side::Cloud { self.local_activity() } else { LocalActivity::default() },
            notice: self.notice.clone(),
            vm: self.vm.clone(),
            group_name: self.group_name.clone(),
            retry_in_ms: None,
        }
    }

    // ── Inputs ────────────────────────────────────────────────────

    /// The person (or the shell, for them) chose a side, already checked
    /// with [`Switchboard::may_switch`]; a cloud switch has already told
    /// igni server the events owner.
    pub fn switch(&mut self, side: Side) -> Vec<Effect> {
        self.want_cloud = false;
        self.notice = None;
        match side {
            Side::Cloud => {
                self.side = Side::Cloud;
                self.state = self.state.next(&Event::SwitchCloud);
                if self.state == BackendState::Local {
                    self.state = BackendState::Dialing;
                }
                vec![Effect::Remember(Side::Cloud), Effect::PointWindows(WindowTarget::Relay), Effect::LabelMenu(Side::Cloud)]
            }
            Side::Local => {
                let was_cloud = self.side == Side::Cloud;
                self.side = Side::Local;
                self.state = self.state.next(&Event::SwitchLocal);
                self.activity.clear();
                let mut effects = vec![Effect::Remember(Side::Local)];
                if was_cloud {
                    effects.extend([
                        Effect::PutEventsOwner(EventsOwner::Local),
                        Effect::CloseUpstreams(CLOSE_GOING_AWAY),
                        Effect::StopPageOrigins,
                        Effect::PointWindows(WindowTarget::Local),
                        Effect::LabelMenu(Side::Local),
                    ]);
                }
                effects
            }
        }
    }

    /// What the relay saw.
    pub fn relay(&mut self, event: RelayEvent) -> Vec<Effect> {
        if self.side != Side::Cloud {
            return Vec::new();
        }
        match event {
            RelayEvent::Upgraded => self.step(Event::Upgraded),
            RelayEvent::Welcome => self.step(Event::Welcome),
            RelayEvent::Credential(CredentialPush::NeedsReissue) => {
                super::log::line("cloud", "the VM reports needs_reissue, which a person's desktop cannot act on");
                Vec::new()
            }
            RelayEvent::Credential(push) => self.step(Event::Credential(push)),
            RelayEvent::DialFailed { error: DialError::Unauthorized, .. } => self.desktop_signed_out(),
            RelayEvent::DialFailed { error: DialError::Refused(reason), .. } => self.refused(&reason),
            RelayEvent::DialFailed { error: DialError::Unreachable(why), .. } => self.step(Event::Unreachable(why)),
            RelayEvent::Closed(Upstream::Unreachable(why)) => self.step(Event::Unreachable(why)),
            RelayEvent::Closed(Upstream::Refused(reason)) => self.refused(&reason),
            RelayEvent::Closed(Upstream::Ended) => Vec::new(),
        }
    }

    /// igni server's answer to `/v1/me/cloud`.
    pub fn discovered(&mut self, answer: Result<CloudDiscovery, DiscoveryError>, now: Instant) -> Vec<Effect> {
        let discovery = match answer {
            Ok(d) => d,
            Err(DiscoveryError::Unauthorized) => {
                self.policy.availability = CloudAvailability::Unknown;
                return if self.side == Side::Cloud { self.desktop_signed_out() } else { Vec::new() };
            }
            Err(DiscoveryError::NotSupported) => {
                self.policy.availability = CloudAvailability::Unavailable("not_supported".into());
                return self.after_availability();
            }
            Err(DiscoveryError::NoSession | DiscoveryError::NoServer) => {
                self.policy.availability = CloudAvailability::Unknown;
                return Vec::new();
            }
            // Offline or a server error: what was known stays known.
            Err(_) => return Vec::new(),
        };
        self.group_name = discovery.group.as_ref().map(|g| g.name.clone()).filter(|n| !n.is_empty());
        self.policy.availability = discovery.availability.clone();
        if let Some(url) = &discovery.gateway_url {
            match GatewayUrl::parse(url, self.allow_insecure).and_then(|g| g.check_pin(self.gateway_pin.as_deref()).map(|()| g)) {
                Ok(gateway) => self.gateway = Some(gateway),
                Err(e) => {
                    super::log::line("cloud", format!("the discovered gateway is refused: {e}"));
                    self.gateway = None;
                    self.policy.availability = CloudAvailability::Unavailable("gateway_refused".into());
                }
            }
        }
        let mut effects = self.mode_changed(discovery.mode, now);
        effects.extend(self.after_availability());
        effects
    }

    /// The gateway's `/v1/me` answer.
    pub fn vm_status(&mut self, status: Option<VmStatus>) {
        self.vm = status;
    }

    /// The verified pack's mode changed (the backend's pack sync rewrote
    /// `pack.jws`).
    pub fn pack_mode(&mut self, mode: GroupMode, now: Instant) -> Vec<Effect> {
        self.mode_changed(mode, now)
    }

    /// `credentials.json` changed: `account` is who is signed in now, and
    /// `remembered` that account's last side.
    pub fn credentials(&mut self, account: Option<Account>, remembered: Option<Side>) -> Vec<Effect> {
        let previous = self.account.clone();
        self.account = account.clone();
        match (previous, account) {
            (_, None) => {
                self.policy.availability = CloudAvailability::Unknown;
                self.want_cloud = false;
                if self.side == Side::Cloud {
                    self.desktop_signed_out()
                } else {
                    Vec::new()
                }
            }
            (Some(old), Some(new)) if old.key == new.key => {
                if self.state == BackendState::NeedsDesktopSignIn {
                    self.state = self.state.next(&Event::DesktopSignedIn);
                    vec![Effect::PointWindows(WindowTarget::Relay), Effect::RecheckDiscovery]
                } else if self.side == Side::Cloud {
                    // The same account with a new token: re-dial with it.
                    vec![Effect::CloseUpstreams(CLOSE_RESTART)]
                } else {
                    Vec::new()
                }
            }
            (_, Some(_)) => {
                // Another account (or the first sign-in): nothing of the
                // last account's cloud carries over.
                self.policy.availability = CloudAvailability::Unknown;
                self.gateway = None;
                self.vm = None;
                self.group_name = None;
                let mut effects = vec![Effect::StopPageOrigins];
                if self.policy.mode == GroupMode::Cloud {
                    self.side = Side::Cloud;
                    self.state = BackendState::Dialing;
                    effects.extend([Effect::CloseUpstreams(CLOSE_RESTART), Effect::PointWindows(WindowTarget::Relay)]);
                } else {
                    self.want_cloud = remembered == Some(Side::Cloud);
                    if self.side == Side::Cloud {
                        self.side = Side::Local;
                        self.state = BackendState::Local;
                        effects.extend([
                            Effect::CloseUpstreams(CLOSE_GOING_AWAY),
                            Effect::PointWindows(WindowTarget::Local),
                            Effect::LabelMenu(Side::Local),
                        ]);
                    }
                }
                effects.push(Effect::RecheckDiscovery);
                effects
            }
        }
    }

    /// A window's local runs and approvals (reported while it is on this
    /// computer).
    pub fn activity(&mut self, label: &str, report: WindowActivity, now: Instant) -> Vec<Effect> {
        if self.side != Side::Local {
            return Vec::new();
        }
        if report == WindowActivity::default() {
            self.activity.remove(label);
        } else {
            self.activity.insert(label.to_string(), report);
        }
        self.maybe_move_to_cloud(now)
    }

    /// A local run the badge counted has ended (the shell asked the local
    /// backend).
    pub fn local_run_ended(&mut self, label: &str) {
        if let Some(window) = self.activity.get_mut(label) {
            window.runs = 0;
            if window.approvals == 0 {
                self.activity.remove(label);
            }
        }
    }

    /// Time passed: a waiting move to the cloud may now go.
    pub fn tick(&mut self, now: Instant) -> Vec<Effect> {
        self.maybe_move_to_cloud(now)
    }

    /// The person asked to try the cloud again now.
    pub fn retry(&mut self) -> Vec<Effect> {
        if self.side != Side::Cloud {
            return Vec::new();
        }
        self.state = self.state.next(&Event::Retry);
        vec![Effect::RetryNow]
    }

    /// The person dismissed the banner: a refusal already handled, or a
    /// notice.
    pub fn dismiss(&mut self) {
        self.notice = None;
        if self.side == Side::Local && matches!(self.state, BackendState::Refused(_)) {
            self.state = BackendState::Local;
        }
    }

    // ── Internals ─────────────────────────────────────────────────

    fn step(&mut self, event: Event) -> Vec<Effect> {
        self.state = self.state.next(&event);
        Vec::new()
    }

    /// The desktop's own session ended: the windows go to this computer's
    /// backend for the sign-in wall, and come back once it is signed in.
    fn desktop_signed_out(&mut self) -> Vec<Effect> {
        let was = self.state.clone();
        self.state = self.state.next(&Event::Unauthorized);
        if was == BackendState::NeedsDesktopSignIn {
            return Vec::new();
        }
        vec![
            Effect::CloseUpstreams(CLOSE_GOING_AWAY),
            Effect::StopPageOrigins,
            Effect::PointWindows(WindowTarget::SignIn),
        ]
    }

    /// A 1008 (or 403) refusal from the gateway.
    fn refused(&mut self, reason: &str) -> Vec<Effect> {
        if reason == GROUP_LOCAL_ONLY {
            let mut effects = self.mode_changed(GroupMode::Local, Instant::now());
            effects.push(Effect::RecheckDiscovery);
            return effects;
        }
        let was_refused = matches!(self.state, BackendState::Refused(_));
        self.state = self.state.next(&Event::Refused(reason.to_string()));
        let mut effects = Vec::new();
        if !was_refused {
            effects.push(Effect::StopPageOrigins);
        }
        if self.policy.may_use_local() {
            // Back to this computer, the banner naming why.
            self.side = Side::Local;
            effects.extend([
                Effect::PutEventsOwner(EventsOwner::Local),
                Effect::CloseUpstreams(CLOSE_GOING_AWAY),
                Effect::PointWindows(WindowTarget::Local),
                Effect::LabelMenu(Side::Local),
            ]);
        }
        effects.push(Effect::RecheckDiscovery);
        effects
    }

    /// The cloud became unavailable while the app is on it.
    fn after_availability(&mut self) -> Vec<Effect> {
        if self.want_cloud && self.side == Side::Local {
            self.want_cloud = false;
            if self.may_switch(Side::Cloud).is_ok() {
                self.side = Side::Cloud;
                self.state = BackendState::Dialing;
                return vec![Effect::PointWindows(WindowTarget::Relay), Effect::LabelMenu(Side::Cloud)];
            }
            return Vec::new();
        }
        if self.side == Side::Cloud && !self.policy.may_use_cloud() {
            if let CloudAvailability::Unavailable(reason) = self.policy.availability.clone() {
                let mut effects = self.refused(&reason);
                // Discovery was just asked; no need to ask again.
                effects.retain(|e| *e != Effect::RecheckDiscovery);
                return effects;
            }
        }
        Vec::new()
    }

    /// The group's mode changed (§6.6).
    fn mode_changed(&mut self, mode: GroupMode, now: Instant) -> Vec<Effect> {
        let old = self.policy.mode;
        if old == mode {
            return Vec::new();
        }
        self.policy.mode = mode;
        let mut effects = Vec::new();
        match mode {
            GroupMode::Local => {
                self.want_cloud = false;
                self.cloud_move_since = None;
                if matches!(self.notice, Some(Notice::MovingToCloud { .. })) {
                    self.notice = None;
                }
                if !self.full_backend {
                    self.full_backend = true;
                    effects.push(Effect::SpawnFullBackend);
                }
                if self.side == Side::Cloud || matches!(self.state, BackendState::Refused(_)) {
                    self.side = Side::Local;
                    self.state = BackendState::Local;
                    self.notice = Some(Notice::MovedToLocal);
                    effects.extend([
                        Effect::CloseUpstreams(CLOSE_GOING_AWAY),
                        Effect::StopPageOrigins,
                        Effect::PointWindows(WindowTarget::Local),
                        Effect::LabelMenu(Side::Local),
                    ]);
                }
            }
            GroupMode::Cloud => {
                if self.side == Side::Local {
                    self.cloud_move_since = Some(now);
                    self.notice = Some(Notice::MovingToCloud { approvals: self.local_activity().approvals });
                    effects.extend(self.maybe_move_to_cloud(now));
                } else if self.full_backend {
                    self.full_backend = false;
                    effects.push(Effect::UseAccountOnlyBackend);
                }
            }
            GroupMode::LocalAndCloud => {
                self.cloud_move_since = None;
                if matches!(self.notice, Some(Notice::MovingToCloud { .. })) {
                    self.notice = None;
                }
                if !self.full_backend {
                    self.full_backend = true;
                    effects.push(Effect::SpawnFullBackend);
                }
            }
        }
        effects
    }

    fn maybe_move_to_cloud(&mut self, now: Instant) -> Vec<Effect> {
        let Some(since) = self.cloud_move_since else {
            return Vec::new();
        };
        let activity = self.local_activity();
        let timed_out = now.duration_since(since) >= CLOUD_MOVE_WAIT;
        if activity.runs > 0 && !timed_out {
            if let Some(Notice::MovingToCloud { approvals }) = &mut self.notice {
                *approvals = activity.approvals;
            }
            return Vec::new();
        }
        self.cloud_move_since = None;
        self.side = Side::Cloud;
        self.state = BackendState::Dialing;
        self.notice = Some(Notice::MovedToCloud { after_wait: timed_out && activity.runs > 0, approvals_dropped: activity.approvals });
        self.activity.clear();
        let mut effects = vec![
            Effect::PutEventsOwner(EventsOwner::Cloud),
            Effect::Remember(Side::Cloud),
            Effect::PointWindows(WindowTarget::Relay),
            Effect::LabelMenu(Side::Cloud),
        ];
        if self.full_backend {
            self.full_backend = false;
            effects.push(Effect::UseAccountOnlyBackend);
        }
        effects
    }
}

#[cfg(test)]
mod tests;
