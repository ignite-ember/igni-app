//! The desktop CI step of design §12.1, against real igni-core backends.
//!
//! Two backends are started from igni-core's venv: one stands for this
//! computer's, one for the person's igni in the VM. A stand-in gateway
//! (`/v1/connect` with the bearer checked and `igni.v1` echoed, relaying
//! to the second backend with its token, as the gateway relays to the
//! node) sits in front of the second. The controller switches to the
//! cloud as `switch_backend` does, a window connects through the relay
//! with the URL the shell gives it, igni's own `welcome` and an RPC
//! answer come back through it, and then one whole chat turn: the
//! message goes through the relay, the VM's igni asks a scripted model
//! (a deterministic OpenAI-compatible server in the test, see
//! [`ScriptedModel`]), its reply streams back as `content_delta`s and the
//! run ends with `run_completed`. The local backend's process is still
//! alive, and the switch back closes the cloud window.
//!
//! Ignored by default: it needs igni-core's venv (`IGNI_CORE_DIR`, or
//! `../igni-core` beside this repository, `uv sync`ed). The tauri-smoke
//! CI job runs `cargo test -- --ignored`, which includes it.
//!
//! §15's step is the second test: the VM's igni runs with a layer that
//! serves page files and asks for the page mark (igni-core's §15 seams,
//! `Layer.serves_page_files` and `extension_calls_need_page_mark`), a
//! development extension with a page, an indicator tool and a service is
//! installed in it, and the stand-in gateway marks its streams `pages`
//! and answers `/v1/pages/…` from igni's port, as the node agent and the
//! gateway do. A page file arrives through `cloud_page_origin`, and a
//! `host_model` get and `extension_service_token` answer through the
//! relay. It needs an igni-core with those seams (igni-core's switch
//! work, merged before igni-app in the design's order).

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

fn venv_python() -> PathBuf {
    let python = igni_core().join(".venv/bin/python");
    assert!(python.is_file(), "expected igni-core's venv at {} (IGNI_CORE_DIR)", python.display());
    python
}

/// A deterministic, OpenAI-compatible model for the VM's igni: igni-core's
/// `openai_like` provider posts `/v1/chat/completions` here, and every
/// answer is [`ScriptedModel::REPLY`]. A streamed request gets it in
/// [`ScriptedModel::PIECES`], one server-sent event each and a pause
/// between them, so the reply really streams; any other request gets it
/// whole (igni names the session with one). Every request body is kept,
/// so the test can say what igni asked.
struct ScriptedModel {
    url: String,
    requests: Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
}

impl ScriptedModel {
    const PIECES: [&'static str; 3] = ["The relay ", "carried this ", "turn."];
    const REPLY: &'static str = "The relay carried this turn.";
    const MODEL: &'static str = "scripted";

    async fn start() -> Self {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://127.0.0.1:{}/v1", listener.local_addr().unwrap().port());
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let kept = requests.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let kept = kept.clone();
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut byte = [0u8; 1];
                    while !head.ends_with(b"\r\n\r\n") {
                        if stream.read(&mut byte).await.unwrap_or(0) == 0 {
                            return;
                        }
                        head.push(byte[0]);
                    }
                    let head = String::from_utf8_lossy(&head).into_owned();
                    let length = head
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                        .unwrap_or(0);
                    let mut body = vec![0u8; length];
                    if stream.read_exact(&mut body).await.is_err() {
                        return;
                    }
                    if !head.starts_with("POST ") || !head.split(' ').nth(1).unwrap_or("").ends_with("/chat/completions") {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                        return;
                    }
                    let request: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
                    let streamed = request["stream"] == true;
                    kept.lock().unwrap().push(request);
                    let usage = serde_json::json!({"prompt_tokens": 1, "completion_tokens": 3, "total_tokens": 4});
                    if !streamed {
                        let answer = serde_json::json!({
                            "id": "chatcmpl-scripted", "object": "chat.completion", "created": 1, "model": Self::MODEL,
                            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": Self::REPLY}}],
                            "usage": usage,
                        })
                        .to_string();
                        let _ = stream
                            .write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}", answer.len()).as_bytes())
                            .await;
                        return;
                    }
                    let chunk = |delta: serde_json::Value, finish: serde_json::Value| {
                        let mut chunk = serde_json::json!({
                            "id": "chatcmpl-scripted", "object": "chat.completion.chunk", "created": 1, "model": Self::MODEL,
                            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
                        });
                        if !finish.is_null() {
                            chunk["usage"] = usage.clone();
                        }
                        format!("data: {chunk}\n\n")
                    };
                    if stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n").await.is_err() {
                        return;
                    }
                    for piece in Self::PIECES {
                        let event = chunk(serde_json::json!({"role": "assistant", "content": piece}), serde_json::Value::Null);
                        if stream.write_all(event.as_bytes()).await.is_err() {
                            return;
                        }
                        let _ = stream.flush().await;
                        tokio::time::sleep(Duration::from_millis(40)).await;
                    }
                    let end = chunk(serde_json::json!({}), serde_json::Value::from("stop"));
                    let _ = stream.write_all(format!("{end}data: [DONE]\n\n").as_bytes()).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        Self { url, requests }
    }

    /// The VM's igni configuration: this model is its only one.
    fn config(&self) -> String {
        format!(
            "update_check_ttl: 0\nplugins:\n  default_marketplace: false\nmodels:\n  default: {m}\n  registry:\n    {m}:\n      provider: openai_like\n      model_id: {m}\n      url: {url}\n      api_key: scripted-key\n      context_window: 8192\n      vision: false\n",
            m = Self::MODEL,
            url = self.url
        )
    }

    fn requests(&self) -> Vec<serde_json::Value> {
        self.requests.lock().unwrap().clone()
    }
}

/// The text of the last `user` message in a chat-completions request.
fn last_user_text(request: &serde_json::Value) -> String {
    let Some(messages) = request["messages"].as_array() else { return String::new() };
    let Some(user) = messages.iter().rev().find(|m| m["role"] == "user") else { return String::new() };
    match &user["content"] {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

fn start_backend(name: &str, home: &std::path::Path) -> Backend {
    start_backend_with(name, home, &["-m", "igni_core.backend"], &[])
}

/// A backend from `argv` (the module, or a launcher script) with extra
/// environment.
fn start_backend_with(name: &str, home: &std::path::Path, argv: &[&str], env: &[(&str, &str)]) -> Backend {
    let python = venv_python();
    let dir = std::env::temp_dir().join(format!("igni-live-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let token = format!("live-token-{name}");
    let mut child = Command::new(python)
        .args(argv)
        .args(["--ws-port", "0", "--project-dir"])
        .arg(&dir)
        .envs(env.iter().copied())
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
async fn a_real_igni_runs_a_chat_turn_through_the_relay_and_the_local_backend_keeps_running() {
    let home = std::env::temp_dir().join(format!("igni-live-home-{}", std::process::id()));
    let vm_home = std::env::temp_dir().join(format!("igni-live-vm-home-{}", std::process::id()));
    for dir in [&home, &vm_home] {
        let _ = std::fs::remove_dir_all(dir);
        std::fs::create_dir_all(dir.join(".igni")).unwrap();
    }
    // The VM's igni has a home of its own, whose only model is scripted.
    let model = ScriptedModel::start().await;
    std::fs::write(vm_home.join(".igni/config.yaml"), model.config()).unwrap();
    let local = start_backend("local", &home);
    let vm = start_backend("vm", &vm_home);
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

    // One chat turn, through the relay: the message out, the reply
    // streamed back in pieces, the run's end.
    let asked = "Say something through the relay.";
    window
        .send(Message::text(serde_json::json!({"type": "user_message", "id": "turn-1", "text": asked}).to_string()))
        .await
        .unwrap();
    let mut deltas = Vec::new();
    let mut seen = Vec::new();
    let completed = loop {
        let message = tokio::time::timeout(Duration::from_secs(60), window.next()).await.expect("the turn's frames in time");
        let Some(Ok(Message::Text(text))) = message else { continue };
        let frame: serde_json::Value = serde_json::from_str(text.as_str()).unwrap();
        let kind = frame["type"].as_str().unwrap_or("").to_string();
        assert!(kind != "error" && kind != "run_error", "the turn failed: {frame}");
        if frame["id"] == "turn-1" {
            seen.push(kind.clone());
        }
        match kind.as_str() {
            "content_delta" if frame["id"] == "turn-1" && frame["is_thinking"] != true => {
                deltas.push(frame["text"].as_str().unwrap_or("").to_string());
            }
            "run_completed" if frame["id"] == "turn-1" => break frame,
            _ => {}
        }
    };
    assert_eq!(deltas.concat(), ScriptedModel::REPLY, "the reply, as the model said it: {seen:?}");
    assert!(deltas.len() >= ScriptedModel::PIECES.len(), "the reply streamed, piece by piece: {deltas:?}");
    let started = seen.iter().position(|k| k == "run_started").expect("run_started came through the relay");
    let first_delta = seen.iter().position(|k| k == "content_delta").unwrap();
    assert!(started < first_delta, "the run started before its reply: {seen:?}");
    assert!(!completed["run_id"].as_str().unwrap_or("").is_empty(), "{completed}");
    assert_eq!(completed["output_tokens"], 3, "the model's own count: {completed}");
    let end = next_frame(&mut window, "stream_end").await;
    assert_eq!(end["id"], "turn-1");
    // It was the VM's igni that asked the model, with the person's words.
    let requests = model.requests();
    let turn = requests.iter().find(|r| r["stream"] == true).expect("a streamed request reached the model");
    // igni puts its own context (the date) before the person's words.
    let said = last_user_text(turn);
    assert!(said.ends_with(asked), "the model was asked: {said:?}");
    assert_eq!(turn["model"], ScriptedModel::MODEL);

    // The local backend was never touched.
    #[cfg(unix)]
    assert!(crate::discovery::pid_alive(local.child.id() as i32), "the local backend keeps running");

    let c = controller.clone();
    blocking(move || c.switch(Side::Local)).await.unwrap();
    until("the windows went back", || shell.pointed.lock().unwrap().last().map(|(t, _)| *t) == Some(WindowTarget::Local)).await;
    #[cfg(unix)]
    assert!(crate::discovery::pid_alive(local.child.id() as i32));
    drop(vm);
    let _ = std::fs::remove_dir_all(&home);
    let _ = std::fs::remove_dir_all(&vm_home);
}


// ── §15: extension pages through the relay and the page origins ──────

/// The VM's igni for §15: igni-core's backend under a layer that serves
/// page files and honours only page-marked callers, as the cloud layer
/// does, without the cloud layer's PostgreSQL.
const PAGE_HOST_LAUNCHER: &str = r#"
from igni_core.core.layer import Layer, layers

class PageHost(Layer):
    def extension_calls_need_page_mark(self):
        return True

    def serves_page_files(self):
        return True

layers.install(PageHost())
from igni_core.backend.__main__ import main
main()
"#;

/// A development extension with a page, an indicator tool and a service.
fn install_extension(home: &std::path::Path, python: &std::path::Path) {
    let bundle = home.join("bundle");
    std::fs::create_dir_all(bundle.join("ui")).unwrap();
    std::fs::write(
        bundle.join("server.py"),
        "from mcp.server.mcpserver import MCPServer\nm = MCPServer('acme.reviewer')\n\n@m.tool()\ndef queue_size() -> dict:\n    return {'label': '3 waiting', 'tone': 'warning', 'detail': ''}\n\nm.run()\n",
    )
    .unwrap();
    std::fs::write(bundle.join("ui/index.html"), "<!doctype html><title>Reviews</title><h1>Reviews from the VM</h1>").unwrap();
    let manifest = serde_json::json!({
        "id": "acme.reviewer", "version": "1.0.0", "contract": ">=1.0 <2", "name": "Reviewer", "trust": "unsigned",
        "dev": {"command": [python, "server.py"]},
        "permissions": {"host": ["chat.read"], "rpc": ["ext.acme.reviewer.*"]},
        "contributes": {
            "pages": [{"kind": "acme.reviewer.page", "label": "Reviews"}],
            "settings": [{"key": "serviceUrl", "type": "string", "label": "Service", "default": "http://127.0.0.1:18799"}]
        }
    });
    std::fs::write(bundle.join("manifest.json"), manifest.to_string()).unwrap();
    let added = Command::new(python)
        .args(["-c", "import sys; from pathlib import Path; from igni_core.extensions.store import ExtensionStore; ExtensionStore().add(Path(sys.argv[1]))"])
        .arg(&bundle)
        .env("HOME", home)
        .status()
        .unwrap();
    assert!(added.success(), "the extension did not install");
}

/// The gateway for §15: `/v1/connect` relays on a stream marked `pages`
/// (the header the node agent adds), and `GET /v1/pages/{id}{path}` is
/// answered from igni's port with the mark, as §15.3's route does. The
/// VM is filled in once it has started.
async fn page_gateway(vm: Arc<std::sync::Mutex<Option<(u16, String)>>>, bearer_ends_with: &'static str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let vm = vm.lock().unwrap().clone().expect("the VM's igni has started");
            tokio::spawn(async move {
                let mut peek = [0u8; 16];
                let n = stream.peek(&mut peek).await.unwrap_or(0);
                if peek[..n].starts_with(b"GET /v1/pages/") {
                    let mut head = Vec::new();
                    let mut byte = [0u8; 1];
                    while !head.ends_with(b"\r\n\r\n") {
                        if stream.read(&mut byte).await.unwrap_or(0) == 0 {
                            return;
                        }
                        head.push(byte[0]);
                    }
                    let head = String::from_utf8_lossy(&head).into_owned();
                    let authorised = head.lines().any(|l| l.to_ascii_lowercase().starts_with("authorization: bearer") && l.trim_end().ends_with(bearer_ends_with));
                    let target = head.split(' ').nth(1).unwrap_or("").to_string();
                    if !authorised || head.to_ascii_lowercase().contains("\norigin:") {
                        let _ = stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                        return;
                    }
                    let path = target.strip_prefix("/v1/pages/").unwrap_or("");
                    let mut node = tokio::net::TcpStream::connect(("127.0.0.1", vm.0)).await.unwrap();
                    let request = format!(
                        "GET /.igni/pages/{path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Igni-Gateway: pages\r\nConnection: close\r\nUser-Agent: igni-gateway\r\n\r\n",
                        vm.0
                    );
                    node.write_all(request.as_bytes()).await.unwrap();
                    let _ = tokio::io::copy(&mut node, &mut stream).await;
                    let _ = stream.shutdown().await;
                    return;
                }
                let check = |req: &Request, mut res: Response| -> Result<Response, ErrorResponse> {
                    let ok = req
                        .headers()
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .is_some_and(|v| v.starts_with("Bearer ") && v.ends_with(bearer_ends_with));
                    let pages = req.uri().query().is_some_and(|q| q.split('&').any(|p| p == "pages=1"));
                    if !ok || !pages {
                        let mut refusal = ErrorResponse::new(None);
                        *refusal.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED;
                        return Err(refusal);
                    }
                    res.headers_mut().insert("sec-websocket-protocol", HeaderValue::from_static("igni.v1"));
                    Ok(res)
                };
                let Ok(mut client) = tokio_tungstenite::accept_hdr_async(stream, check).await else { return };
                let mut request = format!("ws://127.0.0.1:{}", vm.0).into_client_request().unwrap();
                let headers = request.headers_mut();
                headers.insert("sec-websocket-protocol", HeaderValue::from_str(&format!("igni.v1, igni-token.{}", vm.1)).unwrap());
                // What the node agent writes on the gateway's word.
                headers.insert("x-igni-gateway", HeaderValue::from_static("pages"));
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

async fn rpc(
    window: &mut tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    id: &str,
    method: &str,
    args: serde_json::Value,
    caller: Option<&str>,
) -> serde_json::Value {
    let mut frame = serde_json::json!({"type": "rpc_request", "id": id, "method": method, "args": args});
    if let Some(caller) = caller {
        frame["caller"] = serde_json::Value::from(caller);
    }
    window.send(Message::text(frame.to_string())).await.unwrap();
    loop {
        let reply = next_frame(window, "rpc_response").await;
        if reply["id"] == id {
            return reply;
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs an igni-core venv with the §15 seams (IGNI_CORE_DIR); run with `cargo test -- --ignored` (CI: tauri-smoke)"]
async fn a_cloud_extension_page_its_host_model_and_its_service_token_work_through_the_shell() {
    let python = venv_python();
    let desktop_home = std::env::temp_dir().join(format!("igni-live15-desktop-{}", std::process::id()));
    let vm_home = std::env::temp_dir().join(format!("igni-live15-vm-{}", std::process::id()));
    for home in [&desktop_home, &vm_home] {
        let _ = std::fs::remove_dir_all(home);
        std::fs::create_dir_all(home.join(".igni")).unwrap();
    }

    let vm_slot = Arc::new(std::sync::Mutex::new(None));
    let gateway = page_gateway(vm_slot.clone(), "LIVE15-SESSION").await;
    // igni server: discovery for the desktop, the token exchange for the VM.
    let server = FakeHttp::routes(vec![
        ("GET /v1/me/cloud ", 200, discovery_body(&gateway, "local_and_cloud", "local")),
        ("PUT /v1/me/cloud/events-owner ", 200, discovery_body(&gateway, "local_and_cloud", "cloud")),
        (
            "POST /v1/oauth/token ",
            200,
            r#"{"access_token":"token-for-the-service","expires_in":600,"issued_token_type":"urn:ietf:params:oauth:token-type:access_token","token_type":"Bearer"}"#.to_string(),
        ),
    ]);
    std::fs::write(desktop_home.join(".igni/credentials.json"), credentials("https://igni.example", "o1", "p1", "LIVE15-SESSION")).unwrap();
    // The VM's own credential and igni server, for the service token.
    std::fs::write(vm_home.join(".igni/credentials.json"), credentials(&server.url(), "o1", "p1", "VM-CREDENTIAL")).unwrap();
    std::fs::write(vm_home.join(".igni/config.yaml"), format!("api_url: {}\n", server.url())).unwrap();
    install_extension(&vm_home, &python);
    let launcher = vm_home.join("page_host.py");
    std::fs::write(&launcher, PAGE_HOST_LAUNCHER).unwrap();

    let local = start_backend("local15", &desktop_home);
    let vm = start_backend_with("vm15", &vm_home, &[launcher.to_str().unwrap()], &[("IGNI_DEV_EXTENSIONS", "1")]);
    *vm_slot.lock().unwrap() = Some((vm.port, vm.token.clone()));

    let settings = CloudSettings { api_url: Some(server.url()), pack_mode: GroupMode::LocalAndCloud, gateway_pin: None };
    let shell = Arc::new(FakeShell::default());
    let controller = CloudController::new(desktop_home.clone(), desktop_home.join("state"), settings, shell.clone(), true);
    controller.start_with(CloudHttp::direct()).await.unwrap();
    let c = controller.clone();
    blocking(move || c.launch()).await;
    let c = controller.clone();
    blocking(move || c.switch(Side::Cloud)).await.unwrap();

    let mut window = connect_window(&controller.window_url(None).unwrap()).await;
    next_frame(&mut window, "welcome").await;
    until("cloud_ready", || controller.snapshot().state == "cloud_ready").await;

    // The extension, as the VM lists it: its origin is VM-internal.
    let mut listed = serde_json::Value::Null;
    for attempt in 0..60 {
        let reply = rpc(&mut window, &format!("list-{attempt}"), "list_extensions", serde_json::json!({}), None).await;
        listed = reply["result"]["extensions"][0].clone();
        if listed["state"] == "READY" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    assert_eq!(listed["state"], "READY", "{listed}");

    // A page-marked connection speaks for the extension.
    let host = rpc(&mut window, "host-1", "host_model", serde_json::json!({"op": "get", "path": "chat.status"}), Some("acme.reviewer")).await;
    assert_eq!(host["result"]["ok"], true, "{host}");
    let token = rpc(&mut window, "token-1", "extension_service_token", serde_json::json!({}), Some("acme.reviewer")).await;
    assert_eq!(token["result"]["ok"], true, "{token}");
    assert_eq!(token["result"]["access_token"], "token-for-the-service");
    assert_eq!(token["result"]["service_url"], "http://127.0.0.1:18799");
    let exchanged = server.requests().into_iter().find(|r| r.starts_with("POST /v1/oauth/token")).expect("the VM exchanged its token");
    assert!(exchanged.contains("VM-CREDENTIAL"), "the VM's own credential is the subject token");
    let tool = rpc(&mut window, "tool-1", "ext.acme.reviewer.queue_size", serde_json::json!({}), Some("acme.reviewer")).await;
    assert!(tool["error"].is_null(), "the indicator's source answers: {tool}");

    // The page file, through the shell's own origin for the extension.
    let origin = controller.page_origin("acme.reviewer").await.unwrap();
    assert_ne!(origin, listed["origin"].as_str().unwrap_or(""), "never the VM's origin");
    let port: u16 = origin.rsplit(':').next().unwrap().parse().unwrap();
    let page = blocking(move || {
        use std::io::{Read, Write};
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    })
    .await;
    assert!(page.starts_with("HTTP/1.1 200"), "{page}");
    assert!(page.to_ascii_lowercase().contains("content-security-policy: "), "igni's own CSP: {page}");
    assert!(page.ends_with("<h1>Reviews from the VM</h1>"), "{page}");

    #[cfg(unix)]
    assert!(crate::discovery::pid_alive(local.child.id() as i32), "the local backend keeps running");
    let c = controller.clone();
    blocking(move || c.switch(Side::Local)).await.unwrap();
    until("the page port closed", || std::net::TcpStream::connect(("127.0.0.1", port)).is_err()).await;
    drop(vm);
    let _ = std::fs::remove_dir_all(&desktop_home);
    let _ = std::fs::remove_dir_all(&vm_home);
}
