//! `account_rpc`: the account menu's calls, made on this computer's
//! backend while the windows are on the cloud (§6.4).
//!
//! On the cloud side a window's socket is the relay's, so an RPC it sends
//! reaches the VM's igni. The account is the desktop's, not the VM's: who
//! is signed in here, their plan, signing out. Those few calls go through
//! the shell to the local backend (the full one, or in `cloud` mode the
//! account-only one) over a short connection of the shell's own, and only
//! the methods below are forwarded.
//!
//! `login` is not among them: the browser hand-off reports back on the
//! connection that started it, so the sign-in wall keeps a real socket to
//! this computer's backend ([`super::switchboard::WindowTarget::SignIn`]).

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::backend::BackendConn;

/// The methods `account_rpc` forwards: the account menu's, and the
/// server address the sign-in wall may set. Each is one the account-only
/// backend serves (igni-core's `ACCOUNT_RPCS`), so the call is the same
/// whether this computer runs the full backend or that one.
pub(crate) const ACCOUNT_METHODS: [&str; 6] = [
    "get_cloud_plan",
    "clear_cloud_credentials",
    "reload_cloud_credentials",
    "get_status",
    "discover_server",
    "set_server",
];

/// How long one account call may take, the connection included.
const ACCOUNT_TIMEOUT: Duration = Duration::from_secs(30);

/// Whether `method` may be forwarded.
pub(crate) fn allowed(method: &str) -> bool {
    ACCOUNT_METHODS.contains(&method)
}

/// Call `method` with `args` on the backend `conn` names, as the web
/// client's `rpc` would: a typed reply comes back whole, an
/// `rpc_response` as its `result`, its `error` as `Err`.
pub(crate) async fn call(conn: &BackendConn, method: &str, args: Value) -> Result<Value, String> {
    call_with(conn, method, args, None).await
}

/// As [`call`], for a session: `get_processing` asks about one session.
pub(crate) async fn call_with(conn: &BackendConn, method: &str, args: Value, session_id: Option<&str>) -> Result<Value, String> {
    tokio::time::timeout(ACCOUNT_TIMEOUT, exchange(conn, method, args, session_id))
        .await
        .map_err(|_| format!("{method} timed out"))?
}

async fn exchange(conn: &BackendConn, method: &str, args: Value, session_id: Option<&str>) -> Result<Value, String> {
    let mut request = conn.ws_url().into_client_request().map_err(|e| e.to_string())?;
    let protocols = match conn.ws_token() {
        Some(token) => format!("igni.v1, igni-token.{}", token.as_str()),
        None => "igni.v1".to_string(),
    };
    request
        .headers_mut()
        .insert("sec-websocket-protocol", HeaderValue::from_str(&protocols).map_err(|e| e.to_string())?);
    let stream = tokio::net::TcpStream::connect(("127.0.0.1", conn.port()))
        .await
        .map_err(|e| format!("this computer's backend is not reachable ({e})"))?;
    let (mut ws, _) = tokio_tungstenite::client_async(request, stream).await.map_err(|e| e.to_string())?;
    let id = format!("shell-{method}");
    let mut frame = json!({"type": "rpc_request", "id": id, "method": method, "args": args});
    if let Some(session) = session_id {
        frame["session_id"] = Value::from(session);
    }
    ws.send(Message::text(frame.to_string())).await.map_err(|e| e.to_string())?;
    let answer = loop {
        match ws.next().await {
            Some(Ok(Message::Text(text))) => {
                let Ok(reply) = serde_json::from_str::<Value>(text.as_str()) else { continue };
                if reply.get("id").and_then(Value::as_str) != Some(id.as_str()) {
                    continue;
                }
                break reply;
            }
            Some(Ok(_)) => continue,
            _ => return Err("this computer's backend closed the connection".into()),
        }
    };
    let _ = ws.close(None).await;
    if answer.get("type").and_then(Value::as_str) != Some("rpc_response") {
        return Ok(answer);
    }
    match answer.get("error").and_then(Value::as_str) {
        Some(error) if !error.is_empty() => Err(error.to_string()),
        _ => Ok(answer.get("result").cloned().unwrap_or(Value::Null)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{BackendVersionInfo, WsToken};
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};

    /// A stand-in local backend: checks the token, says welcome, answers
    /// each request with `answer(frame)`.
    async fn backend(answer: fn(&Value) -> Value) -> (BackendConn, Arc<Mutex<Vec<Value>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&seen);
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let record = Arc::clone(&record);
                tokio::spawn(async move {
                    let check = |req: &Request, mut res: Response| -> Result<Response, ErrorResponse> {
                        let offered = req.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok()).unwrap_or("");
                        if !offered.contains("igni-token.tok") {
                            let mut refusal = ErrorResponse::new(None);
                            *refusal.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN;
                            return Err(refusal);
                        }
                        res.headers_mut().insert("sec-websocket-protocol", HeaderValue::from_static("igni.v1"));
                        Ok(res)
                    };
                    let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(stream, check).await else { return };
                    let _ = ws.send(Message::text(r#"{"type":"welcome","client_id":"c"}"#)).await;
                    let _ = ws.send(Message::text(r#"{"type":"status_update","id":"other"}"#)).await;
                    while let Some(Ok(Message::Text(t))) = ws.next().await {
                        let frame: Value = serde_json::from_str(t.as_str()).unwrap();
                        record.lock().unwrap().push(frame.clone());
                        let _ = ws.send(Message::text(answer(&frame).to_string())).await;
                    }
                });
            }
        });
        let conn = BackendConn::new(port, Some(WsToken::from("tok".to_string())), BackendVersionInfo::discovered("1".into()));
        (conn, seen)
    }

    #[tokio::test]
    async fn an_account_call_returns_the_result_and_is_sent_as_the_web_sends_it() {
        let (conn, seen) = backend(|f| json!({"type": "rpc_response", "id": f["id"], "result": {"full_name": "Ada"}, "error": null})).await;
        let result = call(&conn, "get_cloud_plan", json!({})).await.unwrap();
        assert_eq!(result, json!({"full_name": "Ada"}));
        let frame = seen.lock().unwrap()[0].clone();
        assert_eq!(frame["type"], "rpc_request");
        assert_eq!(frame["method"], "get_cloud_plan");
        assert!(frame.get("session_id").is_none());
    }

    #[tokio::test]
    async fn an_error_is_an_err_and_a_typed_reply_comes_back_whole() {
        let (conn, _) = backend(|f| json!({"type": "rpc_response", "id": f["id"], "result": null, "error": "nope"})).await;
        assert_eq!(call(&conn, "clear_cloud_credentials", json!({})).await.unwrap_err(), "nope");
        let (conn, _) = backend(|f| json!({"type": "status_update", "id": f["id"], "cloud_connected": false})).await;
        assert_eq!(call(&conn, "clear_cloud_credentials", json!({})).await.unwrap()["type"], "status_update");
    }

    #[tokio::test]
    async fn a_session_call_carries_the_session() {
        let (conn, seen) = backend(|f| json!({"type": "rpc_response", "id": f["id"], "result": false, "error": null})).await;
        assert_eq!(call_with(&conn, "get_processing", json!({}), Some("s1")).await.unwrap(), json!(false));
        assert_eq!(seen.lock().unwrap()[0]["session_id"], "s1");
    }

    #[tokio::test]
    async fn a_dead_backend_is_an_err() {
        let port = crate::cloud::testing::FakeHttp::dead_port();
        let conn = BackendConn::new(port, None, BackendVersionInfo::discovered("1".into()));
        assert!(call(&conn, "get_cloud_plan", json!({})).await.unwrap_err().contains("not reachable"));
    }

    #[test]
    fn only_the_account_methods_are_forwarded() {
        for ok in ACCOUNT_METHODS {
            assert!(allowed(ok));
        }
        for refused in ["user_message", "run_shell", "login", "host_model", "attach_session", "window_model", "get_group_policy", ""] {
            assert!(!allowed(refused), "{refused}");
        }
    }
}
