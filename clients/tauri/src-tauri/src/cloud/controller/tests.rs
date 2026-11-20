//! The controller end to end: a fake shell, a stand-in igni server
//! (`/v1/me/cloud`, the events-owner `PUT`) and a stand-in gateway that
//! speaks igni's side of `/v1/connect`. The switch is driven as the
//! Tauri commands drive it, and a window connects through the relay with
//! the URL the shell would load.

use std::sync::Mutex as StdMutex;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use super::*;
use crate::backend::BackendVersionInfo;
use crate::cloud::session::tests::credentials;
use crate::cloud::mode::GroupMode;
use crate::cloud::testing::FakeHttp;

const SECRET: &str = "SESSION-SECRET-XYZ";

#[derive(Default)]
struct FakeShell {
    snapshots: StdMutex<Vec<BackendSnapshot>>,
    pointed: StdMutex<Vec<(WindowTarget, String)>>,
    calls: StdMutex<Vec<String>>,
}

impl ShellPort for FakeShell {
    fn broadcast(&self, snapshot: &BackendSnapshot) {
        self.snapshots.lock().unwrap().push(snapshot.clone());
    }
    fn point_windows(&self, target: WindowTarget, cloud_url: &str) {
        self.pointed.lock().unwrap().push((target, cloud_url.to_string()));
    }
    fn spawn_full_backend(&self) -> Result<(), String> {
        self.calls.lock().unwrap().push("spawn_full".into());
        Ok(())
    }
    fn use_account_only_backend(&self) -> Result<(), String> {
        self.calls.lock().unwrap().push("account_only".into());
        Ok(())
    }
    fn label_menu(&self, side: Side) {
        self.calls.lock().unwrap().push(format!("label {side:?}"));
    }
    fn local_conn(&self) -> Option<BackendConn> {
        Some(BackendConn::new(1, None, BackendVersionInfo::discovered("1".into())))
    }
    fn focused(&self) -> bool {
        true
    }
    fn stop_page_origins(&self) {
        self.calls.lock().unwrap().push("stop_pages".into());
    }
}

impl FakeShell {
    fn last(&self) -> BackendSnapshot {
        self.snapshots.lock().unwrap().last().cloned().expect("a broadcast")
    }
}

/// A gateway that upgrades with `igni.v1` and says `welcome`.
async fn gateway() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            tokio::spawn(async move {
                let cb = |_: &Request, mut res: Response| -> Result<Response, ErrorResponse> {
                    res.headers_mut().insert("sec-websocket-protocol", HeaderValue::from_static("igni.v1"));
                    Ok(res)
                };
                let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(stream, cb).await else { return };
                let _ = ws.send(Message::text(r#"{"type":"welcome","client_id":"vm-1"}"#)).await;
                while let Some(Ok(_)) = ws.next().await {}
            });
        }
    });
    url
}

fn discovery_body(gateway: &str, mode: &str, owner: &str) -> String {
    format!(
        r#"{{"cloud":"available","reason":null,"gateway_url":"{gateway}","mode":"{mode}","events_owner":"{owner}","group":{{"id":"g","name":"Eng"}},"producer":"person:p1"}}"#
    )
}

struct World {
    controller: CloudController,
    shell: Arc<FakeShell>,
    server: FakeHttp,
    state_dir: PathBuf,
}

async fn world(name: &str, mode: GroupMode, remembered: Option<Side>) -> World {
    let gw = gateway().await;
    let server = FakeHttp::routes(vec![
        ("GET /v1/me/cloud ", 200, discovery_body(&gw, mode.as_str(), "local")),
        ("PUT /v1/me/cloud/events-owner ", 200, discovery_body(&gw, mode.as_str(), "cloud")),
    ]);
    let home = std::env::temp_dir().join(format!("igni-ctl-{}-{name}", std::process::id()));
    let state_dir = home.join("state");
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".igni")).unwrap();
    std::fs::write(home.join(".igni/credentials.json"), credentials("https://igni.example", "o1", "p1", SECRET)).unwrap();
    if let Some(side) = remembered {
        ChoiceStore::in_dir(&state_dir).set("https://igni.example|o1|p1", side, Some(gw.clone())).unwrap();
    }
    let settings = CloudSettings { api_url: Some(server.url()), pack_mode: mode, gateway_pin: None };
    let shell = Arc::new(FakeShell::default());
    let controller = CloudController::new(home, state_dir.clone(), settings, shell.clone(), true);
    controller.start_with(CloudHttp::direct()).await.unwrap();
    World { controller, shell, server, state_dir }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tokio::task::spawn_blocking(f).await.unwrap()
}

/// Connect the way a window does, with the URL the shell gave it.
async fn connect_window(url: &str) -> tokio_tungstenite::WebSocketStream<tokio::net::TcpStream> {
    let (query, fragment) = url.split_once('#').unwrap();
    let token = fragment.strip_prefix("igni_ws_token=").unwrap();
    let port: u16 = query.split("127.0.0.1%3A").nth(1).unwrap().split('&').next().unwrap().parse().unwrap();
    let mut request = format!("ws://127.0.0.1:{port}").into_client_request().unwrap();
    request
        .headers_mut()
        .insert("sec-websocket-protocol", HeaderValue::from_str(&format!("igni.v1, igni-token.{token}")).unwrap());
    request.headers_mut().insert("origin", HeaderValue::from_static("tauri://localhost"));
    let stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    tokio_tungstenite::client_async(request, stream).await.unwrap().0
}

async fn until(what: &str, check: impl Fn() -> bool) {
    for _ in 0..200 {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("never: {what}");
}

#[tokio::test(flavor = "multi_thread")]
async fn switching_to_the_cloud_and_back_through_the_relay() {
    let w = world("switch", GroupMode::LocalAndCloud, None).await;
    let c = w.controller.clone();
    blocking(move || c.launch()).await;
    assert!(w.shell.last().switch_visible, "igni server said available");
    assert_eq!(w.shell.last().side, Side::Local);

    let c = w.controller.clone();
    blocking(move || c.switch(Side::Cloud)).await.unwrap();
    let requests = w.server.requests();
    let put = requests.iter().position(|r| r.starts_with("PUT /v1/me/cloud/events-owner")).expect("the owner was set");
    assert!(requests[put].ends_with(r#"{"owner":"cloud"}"#));
    until("the windows were pointed at the relay", || w.shell.pointed.lock().unwrap().iter().any(|(t, _)| *t == WindowTarget::Relay)).await;
    let url = w.controller.window_url(None).unwrap();
    assert!(url.contains("&side=cloud&backend=cloud-"), "{url}");
    assert_eq!(w.shell.last().state, "dialing");

    let mut window = connect_window(&url).await;
    let first = window.next().await.unwrap().unwrap();
    assert_eq!(first.into_text().unwrap().as_str(), r#"{"type":"welcome","client_id":"vm-1"}"#);
    until("cloud_ready", || w.controller.snapshot().state == "cloud_ready").await;
    assert!(!w.shell.calls.lock().unwrap().iter().any(|c| c == "account_only"), "the local backend keeps running");
    assert_eq!(ChoiceStore::in_dir(&w.state_dir).get("https://igni.example|o1|p1").unwrap().side, Side::Cloud);

    let c = w.controller.clone();
    blocking(move || c.switch(Side::Local)).await.unwrap();
    until("the windows went back", || w.shell.pointed.lock().unwrap().last().map(|(t, _)| *t) == Some(WindowTarget::Local)).await;
    until("the owner went back", || w.server.requests().iter().any(|r| r.ends_with(r#"{"owner":"local"}"#))).await;
    assert!(w.shell.calls.lock().unwrap().contains(&"stop_pages".to_string()));
    assert_eq!(ChoiceStore::in_dir(&w.state_dir).get("https://igni.example|o1|p1").unwrap().side, Side::Local);
    // The relay closed the cloud window for good.
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match window.next().await {
                Some(Ok(Message::Close(frame))) => return frame.map(|f| u16::from(f.code)),
                Some(Ok(_)) => continue,
                _ => return None,
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(closed, Some(1001));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_remembered_cloud_opens_on_the_cloud() {
    let w = world("remembered", GroupMode::LocalAndCloud, Some(Side::Cloud)).await;
    let c = w.controller.clone();
    blocking(move || c.launch()).await;
    assert_eq!(w.controller.target(), WindowTarget::Relay);
    assert!(w.controller.window_url(Some("/ignored")).unwrap().contains("side=cloud"));
}

#[tokio::test(flavor = "multi_thread")]
async fn cloud_mode_starts_without_a_full_backend_and_offers_no_switch() {
    let w = world("cloudmode", GroupMode::Cloud, None).await;
    assert!(w.controller.starts_in_cloud_mode());
    let c = w.controller.clone();
    blocking(move || c.launch()).await;
    let snap = w.shell.last();
    assert_eq!((snap.side, snap.mode), (Side::Cloud, GroupMode::Cloud));
    assert!(snap.chip_visible && !snap.switch_visible);
    let c = w.controller.clone();
    let refused = blocking(move || c.switch(Side::Local)).await;
    assert_eq!(refused, Err("Your organisation runs igni for you in the cloud.".to_string()));
}

#[tokio::test(flavor = "multi_thread")]
async fn local_mode_never_dials() {
    let w = world("localmode", GroupMode::Local, None).await;
    let c = w.controller.clone();
    blocking(move || c.launch()).await;
    let snap = w.shell.last();
    assert!(!snap.switch_visible && !snap.chip_visible);
    let c = w.controller.clone();
    assert!(blocking(move || c.switch(Side::Cloud)).await.is_err());
    assert!(!w.server.requests().iter().any(|r| r.starts_with("PUT")), "no owner change");
    assert!(w.shell.pointed.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_live_mode_change_from_the_pack_moves_the_app() {
    let w = world("livemode", GroupMode::LocalAndCloud, None).await;
    let c = w.controller.clone();
    blocking(move || c.launch()).await;
    let settings = CloudSettings { api_url: Some(w.server.url()), pack_mode: GroupMode::Cloud, gateway_pin: None };
    w.controller.recheck_pack(settings.clone());
    until("the move to the cloud", || w.shell.calls.lock().unwrap().contains(&"account_only".to_string())).await;
    assert_eq!(w.controller.target(), WindowTarget::Relay);
    // Re-reading the same mode changes nothing.
    let before = w.shell.calls.lock().unwrap().len();
    w.controller.recheck_pack(settings);
    assert_eq!(w.shell.calls.lock().unwrap().len(), before);
}

#[tokio::test(flavor = "multi_thread")]
async fn no_command_result_snapshot_or_window_url_carries_the_token() {
    let w = world("secret", GroupMode::LocalAndCloud, Some(Side::Cloud)).await;
    let c = w.controller.clone();
    blocking(move || c.launch()).await;
    let url = w.controller.window_url(None).unwrap();
    assert!(!url.contains(SECRET), "{url}");
    for snapshot in w.shell.snapshots.lock().unwrap().iter() {
        assert!(!serde_json::to_string(snapshot).unwrap().contains(SECRET));
    }
    let mut window = connect_window(&url).await;
    let _ = window.next().await;
    for (_, pointed) in w.shell.pointed.lock().unwrap().iter() {
        assert!(!pointed.contains(SECRET));
    }
    for line in crate::cloud::log::captured() {
        assert!(!line.contains(SECRET), "{line}");
    }
    // The token did go to igni server, as a header and nowhere else.
    assert!(w.server.requests().iter().all(|r| !r.contains(SECRET) || r.to_ascii_lowercase().contains("authorization: bearer")));
}

#[tokio::test(flavor = "multi_thread")]
async fn signing_out_sends_the_cloud_windows_to_the_sign_in_wall() {
    let w = world("signout", GroupMode::LocalAndCloud, Some(Side::Cloud)).await;
    let c = w.controller.clone();
    blocking(move || c.launch()).await;
    std::fs::remove_file(w.controller.inner.home.join(".igni/credentials.json")).unwrap();
    w.controller.credentials_changed();
    until("the sign-in wall", || w.shell.pointed.lock().unwrap().iter().any(|(t, _)| *t == WindowTarget::SignIn)).await;
    assert_eq!(w.controller.snapshot().state, "needs_desktop_sign_in");
}

#[tokio::test(flavor = "multi_thread")]
async fn account_rpc_forwards_only_account_calls() {
    let w = world("account", GroupMode::LocalAndCloud, None).await;
    let refused = w.controller.account_rpc("user_message", Value::Null).await.unwrap_err();
    assert_eq!(refused, "user_message is not an account call");
    // The fake local backend on port 1 is not there: the call is tried.
    assert!(w.controller.account_rpc("get_cloud_plan", Value::Null).await.unwrap_err().contains("not reachable"));
}
