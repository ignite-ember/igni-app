//! Extension pages in cloud mode: one loopback origin per extension,
//! proxying to the gateway's page route (design §15.4).
//!
//! A cloud extension's files are served by the person's igni in the VM,
//! fetched by the gateway at `GET {gateway}/v1/pages/{id}{path}`. The
//! frame cannot load that directly (the CSP is loopback-only, and the
//! session token must stay in Rust), so the shell serves each extension
//! from `http://127.0.0.1:<port>` of its own and adds the token itself.
//! One origin per extension is the same isolation igni-core's
//! `ExtensionOrigin` gives locally.
//!
//! Every request is checked before anything leaves this machine: `GET`
//! only, the `Host` must be this listener's (no DNS rebinding), a head
//! of at most 16 KiB read within 10 s, a path with no `.`/`..` segment,
//! NUL, `\` or `//`. Nothing the frame sent is forwarded but the path:
//! upstream gets the session (read from `credentials.json` on every
//! request), a user agent and nothing else, and no `Origin`. Only an
//! allow-list of response headers comes back, a `200` without a CSP is
//! refused, and the security headers are forced. Any failure upstream is
//! a `503` with `Retry-After`: a page fetch never moves the switch's
//! state, the relay's dial does. Logs name the extension, the path's
//! length, the status and the time; never the token or the path.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use http_body_util::{BodyExt, Empty};
use hyper::body::Bytes;
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::AbortHandle;

use super::log;
use super::net::CloudHttp;
use super::relay::dial::{self, Io};
use super::relay::RelayHooks;

/// The largest page body passed on; a longer one is cut.
pub(crate) const MAX_PAGE_BYTES: u64 = 32 * 1024 * 1024;
/// The largest request head a frame may send.
const MAX_HEAD_BYTES: usize = 16 * 1024;
/// How long a frame has to send its head.
const HEAD_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the gateway has to accept the connection, and to answer.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(60);
/// The longest raw path forwarded.
const MAX_PATH_BYTES: usize = 2048;

/// Response headers copied from the gateway; every other is dropped.
const PASSED_HEADERS: [&str; 7] = [
    "content-type",
    "content-length",
    "content-security-policy",
    "x-content-type-options",
    "cross-origin-resource-policy",
    "cache-control",
    "referrer-policy",
];

/// Set on every answer, whatever came back.
const FORCED_HEADERS: [(&str, &str); 4] = [
    ("X-Content-Type-Options", "nosniff"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
    ("Cache-Control", "no-store"),
    ("Referrer-Policy", "no-referrer"),
];

/// igni-core's `EXTENSION_ID`: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$`.
pub(crate) fn extension_id_ok(id: &str) -> bool {
    let mut parts = id.split('.');
    let Some(first) = parts.next() else { return false };
    let lead = |p: &str| p.chars().next().is_some_and(|c| c.is_ascii_lowercase());
    if !lead(first) || !first.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
        return false;
    }
    let mut rest = 0;
    for part in parts {
        rest += 1;
        if !lead(part) || !part.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            return false;
        }
    }
    rest > 0
}

fn percent_decode(raw: &str) -> Option<Vec<u8>> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    Some(out)
}

/// The gateway's path rules, applied here first: a path that starts with
/// `/`, at most 2048 bytes raw, and, once percent-decoded, no `.` or `..`
/// segment, no NUL, no `\`, no `//`.
pub(crate) fn page_path_ok(raw: &str) -> bool {
    if !raw.starts_with('/') || raw.len() > MAX_PATH_BYTES || raw.contains("//") {
        return false;
    }
    let Some(decoded) = percent_decode(raw) else { return false };
    if decoded.contains(&0) || decoded.contains(&b'\\') || decoded.windows(2).any(|w| w == b"//") {
        return false;
    }
    !decoded.split(|b| *b == b'/').any(|segment| segment == b"." || segment == b"..")
}

/// A frame's request, as much as is read of it.
#[derive(Debug, PartialEq, Eq)]
struct RequestHead {
    method: String,
    target: String,
    host: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum HeadError {
    TooLarge,
    Timeout,
    Malformed,
}

async fn read_head(stream: &mut TcpStream) -> Result<RequestHead, HeadError> {
    let mut buf = Vec::with_capacity(1024);
    let read = async {
        let mut chunk = [0u8; 2048];
        loop {
            if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                return Ok(end);
            }
            if buf.len() > MAX_HEAD_BYTES {
                return Err(HeadError::TooLarge);
            }
            let n = stream.read(&mut chunk).await.map_err(|_| HeadError::Malformed)?;
            if n == 0 {
                return Err(HeadError::Malformed);
            }
            buf.extend_from_slice(&chunk[..n]);
        }
    };
    let end = tokio::time::timeout(HEAD_TIMEOUT, read).await.map_err(|_| HeadError::Timeout)??;
    if end > MAX_HEAD_BYTES {
        return Err(HeadError::TooLarge);
    }
    let text = std::str::from_utf8(&buf[..end]).map_err(|_| HeadError::Malformed)?;
    let mut lines = text.split("\r\n");
    let mut request_line = lines.next().ok_or(HeadError::Malformed)?.split(' ');
    let method = request_line.next().filter(|m| !m.is_empty()).ok_or(HeadError::Malformed)?.to_string();
    let target = request_line.next().ok_or(HeadError::Malformed)?.to_string();
    let host = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("host"))
        .map(|(_, value)| value.trim().to_string());
    Ok(RequestHead { method, target, host })
}

/// A short answer of the shell's own.
async fn answer(stream: &mut TcpStream, status: u16, reason: &str, extra: &[(&str, &str)], body: &str) {
    let mut head = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\n", body.len());
    for (name, value) in FORCED_HEADERS.iter().chain(extra) {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("Connection: close\r\n\r\n");
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Why the gateway's page could not be passed on.
enum Upstream {
    /// 503 + Retry-After: unreachable, refused, not running.
    Unavailable,
    /// 502: a `200` with no CSP, or a body over the cap up front.
    Refused(&'static str),
}

struct Shared {
    hooks: Arc<dyn RelayHooks>,
    http: CloudHttp,
    listeners: Mutex<HashMap<String, (u16, AbortHandle)>>,
}

impl Shared {
    fn listeners(&self) -> MutexGuard<'_, HashMap<String, (u16, AbortHandle)>> {
        self.listeners.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// The page listeners of one cloud side. Owned beside the relay, and
/// stopped with it (§15.4 lifecycle).
#[derive(Clone)]
pub(crate) struct PageOrigins {
    shared: Arc<Shared>,
}

impl PageOrigins {
    pub fn new(hooks: Arc<dyn RelayHooks>, http: CloudHttp) -> Self {
        PageOrigins {
            shared: Arc::new(Shared { hooks, http, listeners: Mutex::new(HashMap::new()) }),
        }
    }

    /// The port serving `extension_id`, started on first ask and the same
    /// for the life of the cloud side.
    pub async fn start_for(&self, extension_id: &str) -> Result<u16, String> {
        if !extension_id_ok(extension_id) {
            return Err(format!("{extension_id:?} is not an extension id"));
        }
        if let Some((port, _)) = self.shared.listeners().get(extension_id) {
            return Ok(*port);
        }
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("the page origin could not bind: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let shared = Arc::clone(&self.shared);
        let id = extension_id.to_string();
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let shared = Arc::clone(&shared);
                let id = id.clone();
                tokio::spawn(async move { serve(stream, port, &id, &shared).await });
            }
        });
        let mut listeners = self.shared.listeners();
        // Two first asks raced: keep the one that got here first.
        if let Some((existing, _)) = listeners.get(extension_id) {
            task.abort();
            return Ok(*existing);
        }
        listeners.insert(extension_id.to_string(), (port, task.abort_handle()));
        Ok(port)
    }

    /// Stop every listener: their ports close, and the next cloud side
    /// gets new ones (new origins, fresh page storage).
    pub fn stop_all(&self) {
        let stopped: Vec<(String, (u16, AbortHandle))> = self.shared.listeners().drain().collect();
        for (_, (_, handle)) in stopped {
            handle.abort();
        }
    }

    #[cfg(test)]
    pub fn running(&self) -> usize {
        self.shared.listeners().len()
    }
}

async fn serve(mut stream: TcpStream, port: u16, id: &str, shared: &Shared) {
    let started = Instant::now();
    let head = match read_head(&mut stream).await {
        Ok(head) => head,
        Err(HeadError::TooLarge) => return answer(&mut stream, 431, "Request Header Fields Too Large", &[], "too large\n").await,
        Err(HeadError::Timeout) => return answer(&mut stream, 408, "Request Timeout", &[], "too slow\n").await,
        Err(HeadError::Malformed) => return answer(&mut stream, 400, "Bad Request", &[], "bad request\n").await,
    };
    if head.method != "GET" {
        return answer(&mut stream, 405, "Method Not Allowed", &[("Allow", "GET")], "GET only\n").await;
    }
    if head.host.as_deref() != Some(format!("127.0.0.1:{port}").as_str()) {
        return answer(&mut stream, 421, "Misdirected Request", &[], "wrong host\n").await;
    }
    let path = head.target.split('?').next().unwrap_or("").to_string();
    if !page_path_ok(&path) {
        return answer(&mut stream, 404, "Not Found", &[], "not found\n").await;
    }
    let outcome = tokio::time::timeout(TOTAL_TIMEOUT, fetch(&mut stream, id, &path, shared)).await;
    let status = match outcome {
        Ok(Ok(status)) => status,
        Ok(Err(Upstream::Refused(why))) => {
            answer(&mut stream, 502, "Bad Gateway", &[], &format!("{why}\n")).await;
            502
        }
        Ok(Err(Upstream::Unavailable)) | Err(_) => {
            answer(&mut stream, 503, "Service Unavailable", &[("Retry-After", "2")], "your cloud igni is not answering; try again\n").await;
            503
        }
    };
    log::line(
        "pages",
        format!("{id}: a {}-byte path answered {status} in {} ms", path.len(), started.elapsed().as_millis()),
    );
}

/// Fetch the page and pass it on; the status sent, or why not.
async fn fetch(window: &mut TcpStream, id: &str, path: &str, shared: &Shared) -> Result<u16, Upstream> {
    let (gateway, session) = shared.hooks.target().map_err(|_| Upstream::Unavailable)?;
    let tcp = tokio::time::timeout(CONNECT_TIMEOUT, dial::connect_tcp(&gateway, &shared.http))
        .await
        .map_err(|_| Upstream::Unavailable)?
        .map_err(|_| Upstream::Unavailable)?;
    let io: Box<dyn Io> = if gateway.tls() {
        Box::new(dial::tls(&gateway, tcp, &shared.http).await.map_err(|_| Upstream::Unavailable)?)
    } else {
        Box::new(tcp)
    };
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(io)).await.map_err(|_| Upstream::Unavailable)?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    let request = hyper::Request::get(gateway.target(&format!("/v1/pages/{id}{path}")))
        .header("host", gateway.authority())
        .header("authorization", session.token.bearer())
        .header("user-agent", concat!("igni-desktop/", env!("CARGO_PKG_VERSION")))
        .header("connection", "close")
        .body(Empty::<Bytes>::new())
        .map_err(|_| Upstream::Unavailable)?;
    let response = sender.send_request(request).await.map_err(|_| Upstream::Unavailable)?;
    let status = match response.status().as_u16() {
        200 => 200,
        404 | 400 => 404,
        _ => return Err(Upstream::Unavailable),
    };
    let headers = response.headers();
    if status == 200 && !headers.contains_key("content-security-policy") {
        return Err(Upstream::Refused("the page came without a Content-Security-Policy"));
    }
    let length = headers
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    if length.is_some_and(|l| l > MAX_PAGE_BYTES) {
        return Err(Upstream::Refused("the page is larger than 32 MiB"));
    }
    let reason = if status == 200 { "OK" } else { "Not Found" };
    let mut head = format!("HTTP/1.1 {status} {reason}\r\n");
    for name in PASSED_HEADERS {
        if FORCED_HEADERS.iter().any(|(forced, _)| forced.eq_ignore_ascii_case(name)) {
            continue;
        }
        if let Some(value) = headers.get(name).and_then(|v| v.to_str().ok()) {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
    }
    for (name, value) in FORCED_HEADERS {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("Connection: close\r\n\r\n");
    window.write_all(head.as_bytes()).await.map_err(|_| Upstream::Unavailable)?;

    let mut body = response.into_body();
    let mut sent: u64 = 0;
    while let Some(frame) = body.frame().await {
        let Ok(frame) = frame else { break };
        let Ok(data) = frame.into_data() else { continue };
        let room = MAX_PAGE_BYTES.saturating_sub(sent) as usize;
        let take = data.len().min(room);
        if window.write_all(&data[..take]).await.is_err() {
            break;
        }
        sent += take as u64;
        if take < data.len() {
            // Over the cap: cut, and the connection closes.
            break;
        }
    }
    let _ = window.shutdown().await;
    Ok(status)
}

#[cfg(test)]
mod tests;
