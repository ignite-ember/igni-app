//! The desktop CI step of design §12.1, against real igni-core backends.
//!
//! Two backends are started from igni-core's venv: one stands for this
//! computer's, one for the person's igni in the VM. A stand-in gateway
//! (`/v1/connect` with the bearer checked and `igni.v1` echoed, relaying
//! to the second backend with its token, as the gateway relays to the
//! node) sits in front of the second. The controller switches to the
//! cloud as `switch_backend` does, a window connects through the relay
//! with the URL the shell gives it, igni's own `welcome` and an RPC
//! answer come back through it, the local backend's process is still
//! alive, and the switch back closes the cloud window.
//!
//! Ignored by default: it needs igni-core's venv (`IGNI_CORE_DIR`, or
//! `../igni-core` beside this repository, `uv sync`ed). The tauri-smoke
//! CI job runs `cargo test -- --ignored`, which includes it.
//!
//! §15's extra step (a page file through `cloud_page_origin`, a
//! `host_model` get and `extension_service_token`) needs a backend whose
//! layer serves page files and asks for the page mark — the cloud layer
//! of igni-core's switch work, not the desktop layer this venv runs — so
//! it is not part of this test yet.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};

use super::*;
use crate::backend::ready_line::ReadyLine;

struct Backend {
    child: Child,
    port: u16,
    token: String,
    _dir: PathBuf,
}

impl Drop for Backend {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn igni_core() -> PathBuf {
    std::env::var_os("IGNI_CORE_DIR").map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap().join("../igni-core")
    })
}

fn start_backend(name: &str, home: &std::path::Path) -> Backend {
    let python = igni_core().join(".venv/bin/python");
    assert!(python.is_file(), "expected igni-core's venv at {} (IGNI_CORE_DIR)", python.display());
    let dir = std::env::temp_dir().join(format!("igni-live-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let token = format!("live-token-{name}");
    let mut child = Command::new(python)
        .args(["-m", "igni_core.backend", "--ws-port", "0", "--project-dir"])
        .arg(&dir)
        .env("HOME", home)
        .env("IGNI_WS_TOKEN", &token)
        .env("IGNI_PARENT_PID", std::process::id().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let port = loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).unwrap() > 0, "the {name} backend exited before its ready line");
        if let Some(port) = ReadyLine::parse(&line) {
            break port;
        }
    };
    std::thread::spawn(move || {
        let mut sink = String::new();
        while reader.read_line(&mut sink).map(|n| n > 0).unwrap_or(false) {
            sink.clear();
        }
    });
    Backend { child, port, token, _dir: dir }
}

/// The gateway's relay, reduced to what the shell meets: a bearer check,
/// `igni.v1` echoed, frames passed to and from the VM's igni.
async fn stand_in_gateway(vm: (u16, String), bearer_ends_with: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let vm = vm.clone();
            tokio::spawn(async move {
                let check = |req: &Request, mut res: Response| -> Result<Response, ErrorResponse> {
                    let ok = req
                        .headers()
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .is_some_and(|v| v.starts_with("Bearer ") && v.ends_with(bearer_ends_with));
                    if !ok || !req.uri().path().ends_with("/v1/connect") {
                        let mut refusal = ErrorResponse::new(None);
                        *refusal.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED;
                        return Err(refusal);
                    }
                    res.headers_mut().insert("sec-websocket-protocol", HeaderValue::from_static("igni.v1"));
                    Ok(res)
                };
                let Ok(mut client) = tokio_tungstenite::accept_hdr_async(stream, check).await else { return };
                let mut request = format!("ws://127.0.0.1:{}", vm.0).into_client_request().unwrap();
                request
                    .headers_mut()
                    .insert("sec-websocket-protocol", HeaderValue::from_str(&format!("igni.v1, igni-token.{}", vm.1)).unwrap());
                let tcp = tokio::net::TcpStream::connect(("127.0.0.1", vm.0)).await.unwrap();
                let (mut node, _) = tokio_tungstenite::client_async(request, tcp).await.unwrap();
                loop {
                    tokio::select! {
                        m = client.next() => match m {
                            Some(Ok(m @ (Message::Text(_) | Message::Binary(_)))) => { let _ = node.send(m).await; }
                            Some(Ok(_)) => {}
                            _ => { let _ = node.close(None).await; return; }
                        },
                        m = node.next() => match m {
                            Some(Ok(m @ (Message::Text(_) | Message::Binary(_)))) => { let _ = client.send(m).await; }
                            Some(Ok(_)) => {}
                            _ => { let _ = client.close(None).await; return; }
                        },
                    }
                }
            });
        }
    });
    url
}

async fn next_frame(window: &mut tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>, kind: &str) -> serde_json::Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(30), window.next()).await.expect("a frame in time");
        if let Some(Ok(Message::Text(text))) = message {
            let frame: serde_json::Value = serde_json::from_str(text.as_str()).unwrap();
            if frame["type"] == kind {
                return frame;
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs igni-core's venv (IGNI_CORE_DIR); run with `cargo test -- --ignored` (CI: tauri-smoke)"]
async fn a_real_igni_answers_through_the_relay_and_the_local_backend_keeps_running() {
    let home = std::env::temp_dir().join(format!("igni-live-home-{}", std::process::id()));
    std::fs::create_dir_all(home.join(".igni")).unwrap();
    let local = start_backend("local", &home);
    let vm = start_backend("vm", &home);
    let gateway = stand_in_gateway((vm.port, vm.token.clone()), "LIVE-SESSION").await;

    std::fs::write(home.join(".igni/credentials.json"), credentials("https://igni.example", "o1", "p1", "LIVE-SESSION")).unwrap();
    let server = FakeHttp::routes(vec![
        ("GET /v1/me/cloud ", 200, discovery_body(&gateway, "local_and_cloud", "local")),
        ("PUT /v1/me/cloud/events-owner ", 200, discovery_body(&gateway, "local_and_cloud", "cloud")),
    ]);
    let settings = CloudSettings { api_url: Some(server.url()), pack_mode: GroupMode::LocalAndCloud, gateway_pin: None };
    let shell = Arc::new(FakeShell::default());
    let controller = CloudController::new(home.clone(), home.join("state"), settings, shell.clone(), true);
    controller.start_with(CloudHttp::direct()).await.unwrap();
    let c = controller.clone();
    blocking(move || c.launch()).await;
    let c = controller.clone();
    blocking(move || c.switch(Side::Cloud)).await.unwrap();

    let url = controller.window_url(None).unwrap();
    let mut window = connect_window(&url).await;
    let welcome = next_frame(&mut window, "welcome").await;
    assert!(welcome["client_id"].as_str().is_some_and(|id| !id.is_empty()), "{welcome}");
    window
        .send(Message::text(r#"{"type":"rpc_request","id":"live-1","method":"get_session_id","args":{}}"#))
        .await
        .unwrap();
    let reply = next_frame(&mut window, "rpc_response").await;
    assert_eq!(reply["id"], "live-1");
    assert!(reply["error"].is_null(), "{reply}");
    until("cloud_ready", || controller.snapshot().state == "cloud_ready").await;

    // The local backend was never touched.
    #[cfg(unix)]
    assert!(crate::discovery::pid_alive(local.child.id() as i32), "the local backend keeps running");

    let c = controller.clone();
    blocking(move || c.switch(Side::Local)).await.unwrap();
    until("the windows went back", || shell.pointed.lock().unwrap().last().map(|(t, _)| *t) == Some(WindowTarget::Local)).await;
    #[cfg(unix)]
    assert!(crate::discovery::pid_alive(local.child.id() as i32));
    let _ = std::fs::remove_dir_all(&home);
}
