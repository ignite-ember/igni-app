//! The switchboard's decisions: each input of §4, §6.6 and §8, and the
//! effects it asks for, in order.

use super::*;
use crate::cloud::state::Unreachable;
use Effect as F;

fn account(sub: &str) -> Account {
    Account { key: format!("https://igni.example|o1|{sub}"), org: "o1".into(), sub: sub.into() }
}

const GW: &str = "https://fleet.acme.example";

fn available(mode: &str) -> CloudDiscovery {
    CloudDiscovery::parse(&format!(
        r#"{{"cloud":"available","gateway_url":"{GW}","mode":"{mode}","events_owner":"local","group":{{"id":"g","name":"Eng"}},"producer":"person:p1"}}"#
    ))
    .unwrap()
}

fn unavailable(mode: &str, reason: &str) -> CloudDiscovery {
    CloudDiscovery::parse(&format!(r#"{{"cloud":"unavailable","reason":"{reason}","gateway_url":"{GW}","mode":"{mode}"}}"#)).unwrap()
}

/// A board in `local_and_cloud`, signed in, discovery answered.
fn both() -> Switchboard {
    let mut board = Switchboard::launch(GroupMode::LocalAndCloud, Some(account("p1")), None, false, None);
    board.discovered(Ok(available("local_and_cloud")), Instant::now());
    board
}

/// The same, switched to the cloud and connected.
fn on_cloud() -> Switchboard {
    let mut board = both();
    board.switch(Side::Cloud);
    board.relay(RelayEvent::Upgraded);
    board.relay(RelayEvent::Welcome);
    assert_eq!(board.state, BackendState::CloudReady { credential_unreachable: false });
    board
}

/// A board in `cloud` mode (from the pack), discovery answered.
fn cloud_mode() -> Switchboard {
    let mut board = Switchboard::launch(GroupMode::Cloud, Some(account("p1")), None, false, None);
    board.discovered(Ok(available("cloud")), Instant::now());
    board
}

#[test]
fn launch_in_each_mode() {
    let local = Switchboard::launch(GroupMode::Local, Some(account("p1")), None, false, None);
    assert_eq!((local.side, local.target(), local.full_backend), (Side::Local, WindowTarget::Local, true));
    assert!(!local.snapshot().switch_visible && !local.snapshot().chip_visible);

    let cloud = Switchboard::launch(GroupMode::Cloud, Some(account("p1")), Some((Side::Local, Some(GW.into()))), false, None);
    assert_eq!((cloud.side, cloud.target(), cloud.full_backend), (Side::Cloud, WindowTarget::Relay, false));
    assert_eq!(cloud.state, BackendState::Dialing);
    assert!(cloud.gateway.is_some(), "the remembered gateway lets an offline launch dial");
    assert!(cloud.snapshot().chip_visible && !cloud.snapshot().switch_visible, "cloud mode: a chip and no control");

    // Signed out: a cloud pack cannot apply, so the full backend runs.
    let nobody = Switchboard::launch(GroupMode::Cloud, None, None, false, None);
    assert_eq!((nobody.side, nobody.full_backend), (Side::Local, true));
}

#[test]
fn a_remembered_cloud_waits_for_discovery_and_falls_back_to_local_if_not_allowed() {
    let mut board = Switchboard::launch(GroupMode::LocalAndCloud, Some(account("p1")), Some((Side::Cloud, None)), false, None);
    assert_eq!(board.side, Side::Local);
    assert!(board.want_cloud);
    let effects = board.discovered(Ok(available("local_and_cloud")), Instant::now());
    assert_eq!(effects, vec![F::PointWindows(WindowTarget::Relay), F::LabelMenu(Side::Cloud)]);
    assert_eq!((board.side, board.state.clone()), (Side::Cloud, BackendState::Dialing));

    let mut refused = Switchboard::launch(GroupMode::LocalAndCloud, Some(account("p1")), Some((Side::Cloud, None)), false, None);
    let effects = refused.discovered(Ok(unavailable("local_and_cloud", "inactive")), Instant::now());
    assert!(effects.is_empty());
    assert_eq!(refused.side, Side::Local);
    assert!(!refused.want_cloud);
}

#[test]
fn the_switch_shows_per_cloud_and_mode() {
    let mut board = Switchboard::launch(GroupMode::LocalAndCloud, Some(account("p1")), None, false, None);
    assert!(!board.snapshot().switch_visible, "not before igni server says so");
    board.discovered(Ok(available("local_and_cloud")), Instant::now());
    assert!(board.snapshot().switch_visible);
    board.discovered(Ok(unavailable("local_and_cloud", "not_licensed")), Instant::now());
    let snap = board.snapshot();
    assert!(!snap.switch_visible);
    assert_eq!((snap.cloud, snap.cloud_reason.as_deref()), ("unavailable", Some("not_licensed")));
}

#[test]
fn flipping_to_cloud_and_back() {
    let mut board = both();
    assert_eq!(board.may_switch(Side::Cloud), Ok(()));
    let effects = board.switch(Side::Cloud);
    assert_eq!(effects, vec![F::Remember(Side::Cloud), F::PointWindows(WindowTarget::Relay), F::LabelMenu(Side::Cloud)]);
    assert_eq!(board.state, BackendState::Dialing);
    assert!(board.snapshot().backend_key.starts_with("cloud-"));
    board.relay(RelayEvent::Upgraded);
    assert_eq!(board.snapshot().state, "waking");
    board.relay(RelayEvent::Welcome);
    assert_eq!(board.snapshot().state, "cloud_ready");

    let effects = board.switch(Side::Local);
    assert_eq!(
        effects,
        vec![
            F::Remember(Side::Local),
            F::PutEventsOwner(EventsOwner::Local),
            F::CloseUpstreams(1001),
            F::StopPageOrigins,
            F::PointWindows(WindowTarget::Local),
            F::LabelMenu(Side::Local),
        ]
    );
    assert_eq!((board.side, board.state.clone()), (Side::Local, BackendState::Local));
    assert_eq!(board.snapshot().backend_key, "local");
}

#[test]
fn switches_the_mode_does_not_allow_are_refused_with_a_reason() {
    let local = Switchboard::launch(GroupMode::Local, Some(account("p1")), None, false, None);
    assert!(local.may_switch(Side::Cloud).is_err());
    let cloud = cloud_mode();
    assert_eq!(cloud.may_switch(Side::Local), Err("Your organisation runs igni for you in the cloud.".into()));
    let unknown = Switchboard::launch(GroupMode::LocalAndCloud, Some(account("p1")), None, false, None);
    assert!(unknown.may_switch(Side::Cloud).is_err(), "not before igni server confirms a cloud igni");
    let mut signed_out = both();
    signed_out.account = None;
    assert!(signed_out.may_switch(Side::Cloud).is_err());
}

#[test]
fn the_credential_push_moves_between_ready_and_needs_sign_in() {
    let mut board = on_cloud();
    board.relay(RelayEvent::Credential(CredentialPush::NeedsSignIn));
    assert_eq!(board.snapshot().state, "cloud_needs_sign_in");
    board.relay(RelayEvent::Credential(CredentialPush::Ready));
    assert_eq!(board.snapshot().state, "cloud_ready");
    board.relay(RelayEvent::Credential(CredentialPush::Unreachable));
    assert!(board.snapshot().credential_warning);
    board.relay(RelayEvent::Credential(CredentialPush::NeedsReissue));
    assert!(board.snapshot().credential_warning, "needs_reissue changes nothing");
}

#[test]
fn a_401_sends_windows_to_the_sign_in_wall_and_a_sign_in_brings_them_back() {
    let mut board = on_cloud();
    let effects = board.relay(RelayEvent::DialFailed { error: DialError::Unauthorized, retry_in: Duration::from_secs(1) });
    assert_eq!(effects, vec![F::CloseUpstreams(1001), F::StopPageOrigins, F::PointWindows(WindowTarget::SignIn)]);
    assert_eq!(board.target(), WindowTarget::SignIn);
    assert_eq!(board.snapshot().backend_key, "local", "the sign-in wall runs on this computer's backend");
    // A second 401 does nothing more.
    assert!(board.relay(RelayEvent::DialFailed { error: DialError::Unauthorized, retry_in: Duration::from_secs(2) }).is_empty());
    let effects = board.credentials(Some(account("p1")), Some(Side::Cloud));
    assert_eq!(effects, vec![F::PointWindows(WindowTarget::Relay), F::RecheckDiscovery]);
    assert_eq!(board.state, BackendState::Dialing);
}

#[test]
fn unreachable_busy_and_could_not_start_are_banners_with_retry() {
    let mut board = on_cloud();
    let net = Unreachable::Network("refused".into());
    board.relay(RelayEvent::DialFailed { error: DialError::Unreachable(net.clone()), retry_in: Duration::from_secs(1) });
    let snap = board.snapshot();
    assert_eq!((snap.state, snap.reason.as_deref(), snap.detail.as_deref()), ("cloud_unreachable", Some("network"), Some("refused")));
    assert!(snap.can_use_local, "Use this computer is offered");
    board.relay(RelayEvent::Closed(Upstream::Unreachable(Unreachable::Busy)));
    assert_eq!(board.snapshot().reason.as_deref(), Some("busy"));
    board.relay(RelayEvent::Closed(Upstream::Unreachable(Unreachable::CouldNotStart("no VM".into()))));
    assert_eq!(board.snapshot().reason.as_deref(), Some("could_not_start"));
    assert_eq!(board.retry(), vec![F::RetryNow]);
    assert_eq!(board.state, BackendState::Dialing);
    board.relay(RelayEvent::Upgraded);
    assert_eq!(board.state, BackendState::Waking);
}

#[test]
fn in_cloud_mode_unreachable_offers_no_way_to_local() {
    let mut board = cloud_mode();
    board.relay(RelayEvent::DialFailed {
        error: DialError::Unreachable(Unreachable::Network("dns".into())),
        retry_in: Duration::from_secs(1),
    });
    let snap = board.snapshot();
    assert_eq!(snap.state, "cloud_unreachable");
    assert!(!snap.can_use_local);
    assert_eq!(board.side, Side::Cloud);
}

#[test]
fn a_refusal_returns_to_local_when_local_is_allowed() {
    let mut board = on_cloud();
    let effects = board.relay(RelayEvent::Closed(Upstream::Refused("inactive".into())));
    assert_eq!(
        effects,
        vec![
            F::StopPageOrigins,
            F::PutEventsOwner(EventsOwner::Local),
            F::CloseUpstreams(1001),
            F::PointWindows(WindowTarget::Local),
            F::LabelMenu(Side::Local),
            F::RecheckDiscovery,
        ]
    );
    let snap = board.snapshot();
    assert_eq!((snap.side, snap.state, snap.reason.as_deref()), (Side::Local, "refused", Some("inactive")));
    board.dismiss();
    assert_eq!(board.state, BackendState::Local);
}

#[test]
fn a_refusal_in_cloud_mode_stays_on_the_cloud() {
    let mut board = cloud_mode();
    let effects = board.relay(RelayEvent::DialFailed { error: DialError::Refused("licence".into()), retry_in: Duration::from_secs(1) });
    assert_eq!(effects, vec![F::StopPageOrigins, F::RecheckDiscovery]);
    assert_eq!((board.side, board.snapshot().state), (Side::Cloud, "refused"));
    board.dismiss();
    assert_eq!(board.snapshot().state, "refused", "a refusal on the cloud side is not dismissed away");
}

#[test]
fn a_kick_for_group_local_only_moves_to_local_and_hides_the_switch() {
    let mut board = on_cloud();
    let effects = board.relay(RelayEvent::Closed(Upstream::Refused("group_local_only".into())));
    assert_eq!(
        effects,
        vec![
            F::CloseUpstreams(1001),
            F::StopPageOrigins,
            F::PointWindows(WindowTarget::Local),
            F::LabelMenu(Side::Local),
            F::RecheckDiscovery,
        ]
    );
    let snap = board.snapshot();
    assert_eq!((snap.side, snap.mode), (Side::Local, GroupMode::Local));
    assert_eq!(snap.notice, Some(Notice::MovedToLocal));
    assert!(!snap.switch_visible && !snap.chip_visible);
}

#[test]
fn discovery_saying_local_while_on_the_cloud_does_the_same() {
    let mut board = on_cloud();
    let effects = board.discovered(Ok(unavailable("local", "group_local_only")), Instant::now());
    assert!(effects.contains(&F::PointWindows(WindowTarget::Local)));
    assert_eq!(board.side, Side::Local);
    assert_eq!(board.notice, Some(Notice::MovedToLocal));
}

#[test]
fn discovery_turning_the_cloud_unavailable_returns_to_local() {
    let mut board = on_cloud();
    let effects = board.discovered(Ok(unavailable("local_and_cloud", "not_licensed")), Instant::now());
    assert!(effects.contains(&F::PointWindows(WindowTarget::Local)));
    assert!(!effects.contains(&F::RecheckDiscovery), "discovery was just asked");
    assert_eq!(board.snapshot().reason.as_deref(), Some("not_licensed"));
}

#[test]
fn moving_to_cloud_waits_for_the_local_run_then_switches() {
    let mut board = both();
    let t0 = Instant::now();
    board.activity("main", WindowActivity { session_id: "s1".into(), runs: 1, approvals: 1 }, t0);
    let effects = board.discovered(Ok(available("cloud")), t0);
    assert!(effects.is_empty(), "a run is in flight: {effects:?}");
    assert_eq!(board.notice, Some(Notice::MovingToCloud { approvals: 1 }));
    assert_eq!(board.side, Side::Local);
    // The run ends: the move goes, and the waiting approval is reported.
    let effects = board.activity("main", WindowActivity { session_id: "s1".into(), runs: 0, approvals: 1 }, t0 + Duration::from_secs(5));
    assert_eq!(
        effects,
        vec![
            F::PutEventsOwner(EventsOwner::Cloud),
            F::Remember(Side::Cloud),
            F::PointWindows(WindowTarget::Relay),
            F::LabelMenu(Side::Cloud),
            F::UseAccountOnlyBackend,
        ]
    );
    assert_eq!(board.notice, Some(Notice::MovedToCloud { after_wait: false, approvals_dropped: 1 }));
    assert!(!board.full_backend);
    assert!(!board.snapshot().switch_visible);
}

#[test]
fn moving_to_cloud_goes_anyway_after_ten_minutes() {
    let mut board = both();
    let t0 = Instant::now();
    board.activity("main", WindowActivity { session_id: "s1".into(), runs: 1, approvals: 0 }, t0);
    board.pack_mode(GroupMode::Cloud, t0);
    assert!(board.tick(t0 + Duration::from_secs(599)).is_empty());
    let effects = board.tick(t0 + CLOUD_MOVE_WAIT);
    assert!(effects.contains(&F::UseAccountOnlyBackend));
    assert_eq!(board.notice, Some(Notice::MovedToCloud { after_wait: true, approvals_dropped: 0 }));
}

#[test]
fn moving_to_cloud_with_nothing_running_is_immediate() {
    let mut board = both();
    let effects = board.pack_mode(GroupMode::Cloud, Instant::now());
    assert!(effects.contains(&F::PointWindows(WindowTarget::Relay)));
    assert_eq!(board.side, Side::Cloud);
}

#[test]
fn local_and_cloud_to_cloud_while_on_the_cloud_only_stops_the_full_backend() {
    let mut board = on_cloud();
    assert_eq!(board.pack_mode(GroupMode::Cloud, Instant::now()), vec![F::UseAccountOnlyBackend]);
    assert_eq!(board.side, Side::Cloud);
}

#[test]
fn leaving_cloud_mode_spawns_a_full_backend() {
    let mut board = cloud_mode();
    assert_eq!(board.pack_mode(GroupMode::LocalAndCloud, Instant::now()), vec![F::SpawnFullBackend]);
    assert_eq!(board.side, Side::Cloud, "local_and_cloud stays on the cloud");
    assert!(board.snapshot().switch_visible);

    let mut board = cloud_mode();
    let effects = board.pack_mode(GroupMode::Local, Instant::now());
    assert_eq!(effects[0], F::SpawnFullBackend, "the backend exists before windows point at it");
    assert!(effects.contains(&F::PointWindows(WindowTarget::Local)));
    assert_eq!(board.side, Side::Local);
}

#[test]
fn signing_out_on_the_cloud_shows_the_sign_in_wall() {
    let mut board = on_cloud();
    let effects = board.credentials(None, None);
    assert_eq!(effects, vec![F::CloseUpstreams(1001), F::StopPageOrigins, F::PointWindows(WindowTarget::SignIn)]);
    assert_eq!(board.snapshot().state, "needs_desktop_sign_in");
    let mut local = both();
    assert!(local.credentials(None, None).is_empty());
    assert!(!local.snapshot().switch_visible);
}

#[test]
fn a_new_token_for_the_same_account_redials() {
    let mut board = on_cloud();
    assert_eq!(board.credentials(Some(account("p1")), Some(Side::Cloud)), vec![F::CloseUpstreams(1012)]);
    assert_eq!(board.state, BackendState::CloudReady { credential_unreachable: false });
}

#[test]
fn another_account_starts_from_its_own_choice() {
    let mut board = on_cloud();
    let effects = board.credentials(Some(account("p2")), Some(Side::Cloud));
    assert_eq!(
        effects,
        vec![
            F::StopPageOrigins,
            F::CloseUpstreams(1001),
            F::PointWindows(WindowTarget::Local),
            F::LabelMenu(Side::Local),
            F::RecheckDiscovery,
        ]
    );
    assert!(board.want_cloud, "p2 last chose the cloud");
    assert!(board.gateway.is_none(), "nothing of p1's cloud carries over");
    let effects = board.discovered(Ok(available("local_and_cloud")), Instant::now());
    assert!(effects.contains(&F::PointWindows(WindowTarget::Relay)));
}

#[test]
fn a_second_welcome_keeps_the_page_origins() {
    let mut board = on_cloud();
    assert!(board.relay(RelayEvent::Welcome).is_empty(), "a node move stops nothing");
    assert_eq!(board.snapshot().state, "cloud_ready");
}

#[test]
fn every_way_into_local_refused_or_sign_in_stops_the_page_origins() {
    let into_local = on_cloud().switch(Side::Local);
    let refused = on_cloud().relay(RelayEvent::Closed(Upstream::Refused("inactive".into())));
    let sign_in = on_cloud().relay(RelayEvent::DialFailed { error: DialError::Unauthorized, retry_in: Duration::ZERO });
    let kicked = on_cloud().relay(RelayEvent::Closed(Upstream::Refused("group_local_only".into())));
    let account_change = on_cloud().credentials(Some(account("p9")), None);
    let signed_out = on_cloud().credentials(None, None);
    for (name, effects) in [
        ("local", into_local),
        ("refused", refused),
        ("sign in", sign_in),
        ("kicked", kicked),
        ("account", account_change),
        ("signed out", signed_out),
    ] {
        assert!(effects.contains(&F::StopPageOrigins), "{name}: {effects:?}");
    }
    let cloud_refused = cloud_mode().relay(RelayEvent::Closed(Upstream::Refused("inactive".into())));
    assert!(cloud_refused.contains(&F::StopPageOrigins));
}

#[test]
fn the_local_side_ignores_relay_news() {
    let mut board = both();
    assert!(board.relay(RelayEvent::Closed(Upstream::Refused("inactive".into()))).is_empty());
    assert!(board.relay(RelayEvent::Welcome).is_empty());
    assert_eq!(board.state, BackendState::Local);
    assert!(board.retry().is_empty());
}

#[test]
fn the_badge_counts_local_activity_only_on_the_cloud() {
    let mut board = both();
    let now = Instant::now();
    board.activity("main", WindowActivity { session_id: "s1".into(), runs: 1, approvals: 0 }, now);
    board.activity("w-2", WindowActivity { session_id: "s2".into(), runs: 0, approvals: 2 }, now);
    assert_eq!(board.snapshot().local_activity, LocalActivity::default(), "no badge on the local side");
    board.switch(Side::Cloud);
    // The switch clears nothing on the way out: the runs still go on.
    // (The switch to the cloud keeps the reports; only `switch(Local)`
    // clears them.)
    assert_eq!(board.snapshot().local_activity, LocalActivity { runs: 1, approvals: 2 });
    // Reports from cloud windows are ignored.
    board.activity("main", WindowActivity::default(), now);
    assert_eq!(board.snapshot().local_activity.runs, 1);
    board.local_run_ended("main");
    assert_eq!(board.snapshot().local_activity, LocalActivity { runs: 0, approvals: 2 });
    board.switch(Side::Local);
    assert!(board.activity.is_empty());
}

#[test]
fn a_gateway_that_is_not_https_or_not_the_pinned_one_is_unavailable() {
    let mut board = Switchboard::launch(GroupMode::LocalAndCloud, Some(account("p1")), None, false, None);
    let plain = CloudDiscovery::parse(r#"{"cloud":"available","gateway_url":"http://lab.example","mode":"local_and_cloud"}"#).unwrap();
    board.discovered(Ok(plain), Instant::now());
    assert_eq!(board.policy.availability, CloudAvailability::Unavailable("gateway_refused".into()));
    assert!(!board.snapshot().switch_visible);

    let mut pinned = Switchboard::launch(GroupMode::LocalAndCloud, Some(account("p1")), None, false, Some("https://other.example".into()));
    pinned.discovered(Ok(available("local_and_cloud")), Instant::now());
    assert_eq!(pinned.policy.availability, CloudAvailability::Unavailable("gateway_refused".into()));

    // A debug build with the switch takes the lab's plain gateway.
    let mut lab = Switchboard::launch(GroupMode::LocalAndCloud, Some(account("p1")), None, true, None);
    let plain = CloudDiscovery::parse(r#"{"cloud":"available","gateway_url":"http://lab.example","mode":"local_and_cloud"}"#).unwrap();
    lab.discovered(Ok(plain), Instant::now());
    assert!(lab.snapshot().switch_visible);
}

#[test]
fn discovery_failures_keep_what_was_known() {
    let mut board = both();
    assert!(board.discovered(Err(DiscoveryError::Network("dns".into())), Instant::now()).is_empty());
    assert!(board.snapshot().switch_visible);
    board.discovered(Err(DiscoveryError::NotSupported), Instant::now());
    assert_eq!(board.snapshot().cloud_reason.as_deref(), Some("not_supported"));
    let mut cloud = on_cloud();
    let effects = cloud.discovered(Err(DiscoveryError::Unauthorized), Instant::now());
    assert!(effects.contains(&F::PointWindows(WindowTarget::SignIn)));
}

#[test]
fn the_snapshot_names_the_group_and_the_vm() {
    let mut board = on_cloud();
    board.vm_status(Some(VmStatus { state: "running".into(), signed_in: Some(true) }));
    let snap = board.snapshot();
    assert_eq!(snap.group_name.as_deref(), Some("Eng"));
    assert_eq!(snap.vm.unwrap().state, "running");
    let json = serde_json::to_value(board.snapshot()).unwrap();
    for key in ["side", "state", "reason", "mode", "cloud", "switch_visible", "chip_visible", "can_use_local", "backend_key", "local_activity", "notice", "retry_in_ms"] {
        assert!(json.get(key).is_some(), "{key} missing from {json}");
    }
    assert_eq!(json["side"], "cloud");
    assert_eq!(json["mode"], "local_and_cloud");
}
