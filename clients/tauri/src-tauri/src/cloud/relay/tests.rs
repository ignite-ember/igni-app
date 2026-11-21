//! The relay against a stand-in gateway: a loopback WebSocket server that
//! speaks the gateway's side of `/v1/connect` as the contract states it
//! (bearer in the header, `igni.v1` echoed, igni's frames, the close
//! codes), with a scripted behaviour per test.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use super::*;
use crate::cloud::session::tests::credentials;
use crate::cloud::state::Unreachable;

/// What the stand-in gateway does once a connection is upgraded.
#[derive(Clone)]
enum Script {
    /// Send `welcome`, then echo every text frame back prefixed `echo:`.
    WelcomeThenEcho,
    /// Send these frames, then wait.
    Frames(Vec<String>),
    /// Close with this code and reason straight away.
    Close(u16, &'static str),
    /// Refuse the upgrade with this status and body.
    Refuse(u16, &'static str),
}

/// What the stand-in gateway saw of each upgrade.
#[derive(Clone, Debug, Default)]
struct Seen {
    uri: String,
    authorization: Option<String>,
    protocol: Option<String>,
    origin: Option<String>,
}

struct FakeGateway {
    url: String,
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl FakeGateway {
    async fn start(script: Script) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&seen);
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else { return };
                let script = script.clone();
                let record = Arc::clone(&record);
                tokio::spawn(async move {
                    let callback = |req: &Request, mut res: Response| -> Result<Response, ErrorResponse> {
                        let header = |name: &str| req.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
                        record.lock().unwrap().push(Seen {
                            uri: req.uri().to_string(),
                            authorization: header("authorization"),
                            protocol: header("sec-websocket-protocol"),
                            origin: header("origin"),
                        });
                        if let Script::Refuse(status, body) = &script {
                            let mut refusal = ErrorResponse::new(Some(body.to_string()));
                            *refusal.status_mut() = StatusCode::from_u16(*status).unwrap();
                            return Err(refusal);
                        }
                        res.headers_mut().insert("sec-websocket-protocol", HeaderValue::from_static("igni.v1"));
                        Ok(res)
                    };
                    let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(stream, callback).await else { return };
                    match script {
                        Script::WelcomeThenEcho => {
                            let _ = ws.send(Message::text(r#"{"type":"welcome","client_id":"c-1"}"#)).await;
                            while let Some(Ok(message)) = ws.next().await {
                                if let Message::Text(t) = message {
                                    let _ = ws.send(Message::text(format!("echo:{}", t.as_str()))).await;
                                }
                            }
                        }
                        Script::Frames(frames) => {
                            for frame in frames {
                                let _ = ws.send(Message::text(frame)).await;
                            }
                            while let Some(Ok(_)) = ws.next().await {}
                        }
                        Script::Close(code, reason) => {
                            let _ = ws
                                .close(Some(CloseFrame { code: CloseCode::from(code), reason: reason.into() }))
                                .await;
                        }
                        Script::Refuse(..) => {}
                    }
                });
            }
        });
        FakeGateway { url, seen }
    }

    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

/// Hooks that read a credentials file on every dial, like the shell's,
/// and keep every event.
struct TestHooks {
    gateway: String,
    home: PathBuf,
    events: Mutex<Vec<RelayEvent>>,
}

impl RelayHooks for TestHooks {
    fn target(&self) -> Result<(GatewayUrl, Session), DialError> {
        let session = Session::read(&self.home).ok_or(DialError::Unauthorized)?;
        let gateway = GatewayUrl::parse(&self.gateway, true)
            .map_err(|e| DialError::Unreachable(Unreachable::Gateway(e.to_string())))?;
        Ok((gateway, session))
    }

    fn event(&self, event: RelayEvent) {
        self.events.lock().unwrap().push(event);
    }
}

impl TestHooks {
    fn events(&self) -> Vec<RelayEvent> {
        self.events.lock().unwrap().clone()
    }
}

fn home_with(secret: &str) -> PathBuf {
    let home = std::env::temp_dir().join(format!("igni-relay-{}-{}", std::process::id(), secret));
    std::fs::create_dir_all(home.join(".igni")).unwrap();
    std::fs::write(home.join(".igni/credentials.json"), credentials("https://igni.example", "o1", "p1", secret)).unwrap();
    home
}

async fn relay_for(gateway: &FakeGateway, home: PathBuf) -> (Relay, Arc<TestHooks>) {
    let hooks = Arc::new(TestHooks { gateway: gateway.url.clone(), home, events: Mutex::new(Vec::new()) });
    let relay = Relay::start_with_token(hooks.clone(), CloudHttp::direct(), WsToken::from("relay-token".to_string()))
        .await
        .unwrap();
    (relay, hooks)
}

type Window = tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>;

/// Open a window connection the way the web client does.
async fn window(relay: &Relay, origin: Option<&str>, token: Option<&str>) -> Result<Window, tokio_tungstenite::tungstenite::Error> {
    let mut request = format!("ws://127.0.0.1:{}", relay.port()).into_client_request().unwrap();
    let protocols = match token {
        Some(t) => format!("igni.v1, igni-token.{t}"),
        None => "igni.v1".to_string(),
    };
    request.headers_mut().insert("sec-websocket-protocol", HeaderValue::from_str(&protocols).unwrap());
    if let Some(origin) = origin {
        request.headers_mut().insert("origin", HeaderValue::from_str(origin).unwrap());
    }
    let stream = tokio::net::TcpStream::connect(("127.0.0.1", relay.port())).await.unwrap();
    tokio_tungstenite::client_async(request, stream)
        .await
        .map(|(ws, _)| ws)
}

async fn next_text(ws: &mut Window) -> String {
    loop {
        match tokio::time::timeout(Duration::from_secs(5), ws.next()).await.expect("a frame in time") {
            Some(Ok(Message::Text(t))) => return t.as_str().to_string(),
            Some(Ok(_)) => continue,
            other => panic!("expected a text frame, got {other:?}"),
        }
    }
}

/// The close code the window's socket was closed with.
async fn closed_with(ws: &mut Window) -> u16 {
    loop {
        match tokio::time::timeout(Duration::from_secs(5), ws.next()).await.expect("a close in time") {
            Some(Ok(Message::Close(Some(frame)))) => return u16::from(frame.code),
            Some(Ok(Message::Close(None))) => return 1005,
            Some(Ok(_)) => continue,
            other => panic!("expected a close, got {other:?}"),
        }
    }
}

async fn eventually(hooks: &TestHooks, wanted: impl Fn(&[RelayEvent]) -> bool) {
    for _ in 0..100 {
        if wanted(&hooks.events()) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("events never matched: {:?}", hooks.events());
}

#[tokio::test]
async fn a_window_reaches_the_cloud_with_the_bearer_in_the_header_and_frames_pass_unchanged() {
    let gateway = FakeGateway::start(Script::WelcomeThenEcho).await;
    let (relay, hooks) = relay_for(&gateway, home_with("TOKEN-A")).await;
    let mut ws = window(&relay, Some("tauri://localhost"), Some("relay-token")).await.unwrap();
    assert_eq!(next_text(&mut ws).await, r#"{"type":"welcome","client_id":"c-1"}"#);
    ws.send(Message::text(r#"{"type":"rpc_request","id":"r1"}"#)).await.unwrap();
    assert_eq!(next_text(&mut ws).await, r#"echo:{"type":"rpc_request","id":"r1"}"#);

    let seen = gateway.seen().remove(0);
    assert_eq!(seen.uri, "/v1/connect?pages=1");
    assert!(seen.authorization.as_deref().unwrap().starts_with("Bearer h."), "{seen:?}");
    assert!(seen.authorization.as_deref().unwrap().ends_with(".TOKEN-A"), "{seen:?}");
    assert_eq!(seen.protocol.as_deref(), Some("igni.v1"), "only igni.v1 is offered upstream");
    assert_eq!(seen.origin, None, "the relay is a program: no Origin");
    eventually(&hooks, |e| e.contains(&RelayEvent::Upgraded) && e.contains(&RelayEvent::Welcome)).await;
}

#[tokio::test]
async fn the_door_refuses_a_foreign_origin_no_token_or_a_wrong_token() {
    let gateway = FakeGateway::start(Script::WelcomeThenEcho).await;
    let (relay, _hooks) = relay_for(&gateway, home_with("TOKEN-D")).await;
    assert!(window(&relay, Some("https://evil.example"), Some("relay-token")).await.is_err());
    assert!(window(&relay, Some("tauri://localhost"), None).await.is_err());
    assert!(window(&relay, Some("tauri://localhost"), Some("relay-tokeX")).await.is_err());
    assert!(gateway.seen().is_empty(), "a refused window never causes a dial");
    // A loopback page and a program (no Origin) with the token get in.
    assert!(window(&relay, Some("http://127.0.0.1:5179"), Some("relay-token")).await.is_ok());
    assert!(window(&relay, None, Some("relay-token")).await.is_ok());
}

#[tokio::test]
async fn the_session_is_read_on_every_dial() {
    let gateway = FakeGateway::start(Script::WelcomeThenEcho).await;
    let home = home_with("FIRST");
    let (relay, _hooks) = relay_for(&gateway, home.clone()).await;
    let mut first = window(&relay, None, Some("relay-token")).await.unwrap();
    next_text(&mut first).await;
    std::fs::write(home.join(".igni/credentials.json"), credentials("https://igni.example", "o1", "p1", "SECOND")).unwrap();
    let mut second = window(&relay, None, Some("relay-token")).await.unwrap();
    next_text(&mut second).await;
    let seen = gateway.seen();
    assert!(seen[0].authorization.as_deref().unwrap().ends_with(".FIRST"));
    assert!(seen[1].authorization.as_deref().unwrap().ends_with(".SECOND"));
}

#[tokio::test]
async fn close_all_closes_every_window_with_the_code_given() {
    let gateway = FakeGateway::start(Script::WelcomeThenEcho).await;
    let (relay, _hooks) = relay_for(&gateway, home_with("TOKEN-C")).await;
    let mut a = window(&relay, None, Some("relay-token")).await.unwrap();
    let mut b = window(&relay, None, Some("relay-token")).await.unwrap();
    next_text(&mut a).await;
    next_text(&mut b).await;
    relay.close_all(1012);
    assert_eq!(closed_with(&mut a).await, 1012);
    assert_eq!(closed_with(&mut b).await, 1012);
}

#[tokio::test]
async fn a_busy_gateway_closes_the_window_for_a_reconnect() {
    let gateway = FakeGateway::start(Script::Close(1013, "busy")).await;
    let (relay, hooks) = relay_for(&gateway, home_with("TOKEN-B")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    assert_eq!(closed_with(&mut ws).await, 1012);
    eventually(&hooks, |e| e.contains(&RelayEvent::Closed(Upstream::Unreachable(Unreachable::Busy)))).await;
}

#[tokio::test]
async fn a_vm_that_could_not_start_is_reported_with_its_reason() {
    let gateway = FakeGateway::start(Script::Close(1011, "the VM did not start")).await;
    let (relay, hooks) = relay_for(&gateway, home_with("TOKEN-S")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    assert_eq!(closed_with(&mut ws).await, 1012);
    eventually(&hooks, |e| {
        e.contains(&RelayEvent::Closed(Upstream::Unreachable(Unreachable::CouldNotStart("the VM did not start".into()))))
    })
    .await;
}

#[tokio::test]
async fn a_1008_refusal_is_reported_and_never_forwarded() {
    let gateway = FakeGateway::start(Script::Close(1008, "group_local_only: moved to this computer")).await;
    let (relay, hooks) = relay_for(&gateway, home_with("TOKEN-R")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    assert_eq!(closed_with(&mut ws).await, 1001);
    eventually(&hooks, |e| e.contains(&RelayEvent::Closed(Upstream::Refused("group_local_only".into())))).await;
}

#[tokio::test]
async fn a_401_dial_is_the_desktops_sign_in_and_closes_the_window_for_good() {
    let gateway = FakeGateway::start(Script::Refuse(401, "{}")).await;
    let (relay, hooks) = relay_for(&gateway, home_with("TOKEN-U")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    assert_eq!(closed_with(&mut ws).await, 1001);
    eventually(&hooks, |e| e.iter().any(|ev| matches!(ev, RelayEvent::DialFailed { error: DialError::Unauthorized, .. }))).await;
}

#[tokio::test]
async fn a_403_not_a_person_is_a_refusal() {
    let gateway = FakeGateway::start(Script::Refuse(403, r#"{"error":"not_a_person"}"#)).await;
    let (relay, hooks) = relay_for(&gateway, home_with("TOKEN-N")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    assert_eq!(closed_with(&mut ws).await, 1001);
    eventually(&hooks, |e| {
        e.iter().any(|ev| matches!(ev, RelayEvent::DialFailed { error: DialError::Refused(r), .. } if r == "not_a_person"))
    })
    .await;
}

#[tokio::test]
async fn the_credential_push_is_reported_and_still_reaches_the_window() {
    let push = r#"{"type":"push_notification","channel":"vm_credential","payload":{"state":"needs_sign_in","message":""}}"#;
    let gateway = FakeGateway::start(Script::Frames(vec![r#"{"type":"welcome","client_id":"c"}"#.into(), push.into()])).await;
    let (relay, hooks) = relay_for(&gateway, home_with("TOKEN-P")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    next_text(&mut ws).await;
    assert_eq!(next_text(&mut ws).await, push);
    eventually(&hooks, |e| e.contains(&RelayEvent::Credential(CredentialPush::NeedsSignIn))).await;
}

#[tokio::test]
async fn after_a_failed_dial_the_next_window_waits_for_the_backoff_or_a_retry() {
    // Nothing listens on the gateway's port.
    let dead = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}", dead.local_addr().unwrap().port());
    drop(dead);
    let hooks = Arc::new(TestHooks { gateway: url, home: home_with("TOKEN-W"), events: Mutex::new(Vec::new()) });
    let relay = Relay::start_with_token(hooks.clone(), CloudHttp::direct(), WsToken::from("relay-token".to_string())).await.unwrap();

    let mut first = window(&relay, None, Some("relay-token")).await.unwrap();
    assert_eq!(closed_with(&mut first).await, 1012);
    eventually(&hooks, |e| {
        e.iter().any(|ev| matches!(ev, RelayEvent::DialFailed { error: DialError::Unreachable(Unreachable::Network(_)), retry_in } if *retry_in == Duration::from_secs(1)))
    })
    .await;
    assert!(relay.retry_in().is_some());

    // The second window is held: no close inside the backoff's first
    // half, then a retry releases it at once.
    let mut second = window(&relay, None, Some("relay-token")).await.unwrap();
    assert!(tokio::time::timeout(Duration::from_millis(300), second.next()).await.is_err(), "held, not closed");
    relay.retry_now();
    assert_eq!(closed_with(&mut second).await, 1012);
    eventually(&hooks, |e| e.iter().filter(|ev| matches!(ev, RelayEvent::DialFailed { .. })).count() == 2).await;
}

#[test]
fn the_backoff_doubles_from_one_second_to_thirty() {
    let delays: Vec<u64> = (1..=8).map(|n| Backoff::delay(n).as_secs()).collect();
    assert_eq!(delays, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    assert_eq!(Backoff::delay(u32::MAX).as_secs(), 30);
}

#[tokio::test]
async fn the_token_is_never_written_to_the_log() {
    let gateway = FakeGateway::start(Script::Close(1008, "inactive")).await;
    let (relay, _hooks) = relay_for(&gateway, home_with("LOG-SECRET-123")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    closed_with(&mut ws).await;
    let dead = FakeGateway::start(Script::Refuse(401, "{}")).await;
    let (relay, _hooks) = relay_for(&dead, home_with("LOG-SECRET-456")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    closed_with(&mut ws).await;
    let lines = crate::cloud::log::captured();
    assert!(lines.iter().any(|l| l.starts_with("igni relay:")), "the relay logged nothing: {lines:?}");
    for line in lines {
        assert!(!line.contains("LOG-SECRET"), "{line}");
        assert!(!line.contains("Bearer"), "{line}");
        assert!(!line.contains("relay-token"), "{line}");
    }
}

#[tokio::test]
async fn an_upgrade_that_closes_before_welcome_is_still_backed_off() {
    let gateway = FakeGateway::start(Script::Close(1013, "")).await;
    let (relay, _hooks) = relay_for(&gateway, home_with("TOKEN-K")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    closed_with(&mut ws).await;
    assert!(relay.retry_in().is_some(), "a 1013 after the upgrade counts as a failure");
    let ok = FakeGateway::start(Script::WelcomeThenEcho).await;
    let (relay, _hooks) = relay_for(&ok, home_with("TOKEN-L")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    next_text(&mut ws).await;
    assert!(relay.retry_in().is_none(), "a welcome clears it");
}

#[tokio::test]
async fn a_second_welcome_on_the_same_upstream_reaches_the_window_and_is_reported() {
    // A node move as the gateway makes it: the cut-off answer to a call in
    // flight, then the new igni's welcome, with no new connection.
    let cut_off = r#"{"type":"rpc_response","id":"7","error":"igni's connection was moved; retry"}"#;
    let gateway = FakeGateway::start(Script::Frames(vec![
        r#"{"type":"welcome","client_id":"vm-1"}"#.into(),
        cut_off.into(),
        r#"{"type":"welcome","client_id":"vm-2"}"#.into(),
    ]))
    .await;
    let (relay, hooks) = relay_for(&gateway, home_with("TOKEN-M")).await;
    let mut ws = window(&relay, None, Some("relay-token")).await.unwrap();
    assert_eq!(next_text(&mut ws).await, r#"{"type":"welcome","client_id":"vm-1"}"#);
    assert_eq!(next_text(&mut ws).await, cut_off);
    assert_eq!(next_text(&mut ws).await, r#"{"type":"welcome","client_id":"vm-2"}"#);
    eventually(&hooks, |e| e.iter().filter(|ev| **ev == RelayEvent::Welcome).count() == 2).await;
    assert_eq!(gateway.seen().len(), 1, "one upstream: the move happened behind it");
}
