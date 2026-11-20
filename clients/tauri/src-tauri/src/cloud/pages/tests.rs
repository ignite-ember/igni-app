//! The page origins against a stand-in gateway: a loopback HTTP server
//! that answers the page route as §15.3 states it, with a scripted
//! status, headers and body, and records every request it is sent.

use std::path::PathBuf;
use std::sync::Mutex as StdMutex;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;
use crate::cloud::gateway::GatewayUrl;
use crate::cloud::relay::dial::DialError;
use crate::cloud::session::tests::credentials;
use crate::cloud::session::Session;
use crate::cloud::state::Unreachable;

/// One scripted answer.
#[derive(Clone)]
struct Reply {
    status: u16,
    headers: Vec<(&'static str, String)>,
    body: Vec<u8>,
    /// Send no Content-Length, closing after the body.
    stream: bool,
}

fn page(body: &str) -> Reply {
    Reply {
        status: 200,
        headers: vec![
            ("Content-Type", "text/html; charset=utf-8".into()),
            ("Content-Security-Policy", "default-src 'self'; frame-ancestors tauri://localhost".into()),
            ("Set-Cookie", "evil=1".into()),
            ("X-Igni-Secret-Header", "nope".into()),
            ("Cache-Control", "max-age=3600".into()),
            ("Access-Control-Allow-Origin", "*".into()),
        ],
        body: body.as_bytes().to_vec(),
        stream: false,
    }
}

struct FakeGateway {
    url: String,
    seen: Arc<StdMutex<Vec<String>>>,
}

impl FakeGateway {
    async fn start(reply: Reply) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let record = Arc::clone(&seen);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let reply = reply.clone();
                let record = Arc::clone(&record);
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                        let Ok(n) = stream.read(&mut chunk).await else { return };
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    record.lock().unwrap().push(String::from_utf8_lossy(&buf).into_owned());
                    let mut head = format!("HTTP/1.1 {} X\r\n", reply.status);
                    for (name, value) in &reply.headers {
                        head.push_str(&format!("{name}: {value}\r\n"));
                    }
                    if !reply.stream {
                        head.push_str(&format!("Content-Length: {}\r\n", reply.body.len()));
                    }
                    head.push_str("Connection: close\r\n\r\n");
                    let _ = stream.write_all(head.as_bytes()).await;
                    let _ = stream.write_all(&reply.body).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        FakeGateway { url, seen }
    }

    fn seen(&self) -> Vec<String> {
        self.seen.lock().unwrap().clone()
    }
}

/// The controller's hooks, reduced: the gateway, and the session read
/// from a credentials file on every call.
struct Hooks {
    gateway: String,
    home: PathBuf,
}

impl RelayHooks for Hooks {
    fn target(&self) -> Result<(GatewayUrl, Session), DialError> {
        let session = Session::read(&self.home).ok_or(DialError::Unauthorized)?;
        let gateway = GatewayUrl::parse(&self.gateway, true).map_err(|e| DialError::Unreachable(Unreachable::Gateway(e.to_string())))?;
        Ok((gateway, session))
    }
    fn event(&self, _: crate::cloud::relay::RelayEvent) {}
}

fn home(secret: &str) -> PathBuf {
    let home = std::env::temp_dir().join(format!("igni-pages-{}-{secret}", std::process::id()));
    std::fs::create_dir_all(home.join(".igni")).unwrap();
    std::fs::write(home.join(".igni/credentials.json"), credentials("https://igni.example", "o1", "p1", secret)).unwrap();
    home
}

async fn origins_for(gateway: &FakeGateway, secret: &str) -> (PageOrigins, PathBuf) {
    let home = home(secret);
    let origins = PageOrigins::new(Arc::new(Hooks { gateway: gateway.url.clone(), home: home.clone() }), CloudHttp::direct());
    (origins, home)
}

/// Send `request` (with `{port}` filled in) and read the whole answer.
async fn ask(port: u16, request: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(request.replace("{port}", &port.to_string()).as_bytes()).await.unwrap();
    let mut out = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), stream.read_to_end(&mut out)).await.unwrap().unwrap();
    String::from_utf8_lossy(&out).into_owned()
}

fn get(path: &str) -> String {
    format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{{port}}\r\nOrigin: http://127.0.0.1:{{port}}\r\nCookie: session=frame\r\n\
         X-Igni-Gateway: pages\r\nAuthorization: Bearer frame-token\r\n\r\n"
    )
}

fn status_of(answer: &str) -> u16 {
    answer.split(' ').nth(1).unwrap().parse().unwrap()
}

fn header<'a>(answer: &'a str, name: &str) -> Option<&'a str> {
    let head = answer.split("\r\n\r\n").next().unwrap();
    head.lines().filter_map(|l| l.split_once(':')).find(|(n, _)| n.trim().eq_ignore_ascii_case(name)).map(|(_, v)| v.trim())
}

#[tokio::test]
async fn a_page_reaches_the_gateway_route_with_the_session_and_nothing_of_the_frame() {
    let gateway = FakeGateway::start(page("<h1>hello</h1>")).await;
    let (origins, _) = origins_for(&gateway, "PAGE-TOKEN-1").await;
    let port = origins.start_for("acme.reviewer").await.unwrap();
    let answer = ask(port, &get("/index.html?x=1")).await;
    assert_eq!(status_of(&answer), 200, "{answer}");
    assert!(answer.ends_with("<h1>hello</h1>"));

    let sent = gateway.seen().remove(0);
    assert!(sent.starts_with("GET /v1/pages/acme.reviewer/index.html HTTP/1.1\r\n"), "the query is dropped: {sent}");
    let lower = sent.to_ascii_lowercase();
    assert!(lower.contains("authorization: bearer h."), "{sent}");
    assert!(sent.contains("PAGE-TOKEN-1"));
    assert!(!sent.contains("frame-token"), "the frame's own authorisation is not forwarded");
    assert!(!lower.contains("origin:"), "no Origin goes upstream: {sent}");
    assert!(!lower.contains("cookie:"), "{sent}");
    assert!(!lower.contains("x-igni-gateway"), "{sent}");
    assert!(lower.contains("user-agent: igni-desktop/"), "{sent}");
}

#[tokio::test]
async fn only_the_allow_list_comes_back_and_the_security_headers_are_forced() {
    let gateway = FakeGateway::start(page("x")).await;
    let (origins, _) = origins_for(&gateway, "PAGE-TOKEN-2").await;
    let port = origins.start_for("acme.reviewer").await.unwrap();
    let answer = ask(port, &get("/")).await;
    assert_eq!(header(&answer, "content-security-policy"), Some("default-src 'self'; frame-ancestors tauri://localhost"));
    assert_eq!(header(&answer, "content-type"), Some("text/html; charset=utf-8"));
    assert_eq!(header(&answer, "set-cookie"), None);
    assert_eq!(header(&answer, "x-igni-secret-header"), None);
    assert_eq!(header(&answer, "access-control-allow-origin"), None, "no CORS");
    assert_eq!(header(&answer, "x-content-type-options"), Some("nosniff"));
    assert_eq!(header(&answer, "cross-origin-resource-policy"), Some("same-origin"));
    assert_eq!(header(&answer, "cache-control"), Some("no-store"), "forced over what came back");
    assert_eq!(header(&answer, "referrer-policy"), Some("no-referrer"));
    assert!(gateway.seen()[0].starts_with("GET /v1/pages/acme.reviewer/ HTTP/1.1"));
}

#[tokio::test]
async fn the_session_is_read_on_every_request() {
    let gateway = FakeGateway::start(page("x")).await;
    let (origins, home) = origins_for(&gateway, "FIRST-PAGE").await;
    let port = origins.start_for("acme.reviewer").await.unwrap();
    ask(port, &get("/a.js")).await;
    std::fs::write(home.join(".igni/credentials.json"), credentials("https://igni.example", "o1", "p1", "SECOND-PAGE")).unwrap();
    ask(port, &get("/b.js")).await;
    let seen = gateway.seen();
    assert!(seen[0].contains("FIRST-PAGE"));
    assert!(seen[1].contains("SECOND-PAGE"));
}

#[tokio::test]
async fn refusals_before_anything_leaves_this_machine() {
    let gateway = FakeGateway::start(page("x")).await;
    let (origins, _) = origins_for(&gateway, "PAGE-TOKEN-3").await;
    let port = origins.start_for("acme.reviewer").await.unwrap();

    let post = ask(port, "POST /index.html HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 0\r\n\r\n").await;
    assert_eq!(status_of(&post), 405);
    assert_eq!(header(&post, "allow"), Some("GET"));

    let rebinding = ask(port, "GET /index.html HTTP/1.1\r\nHost: evil.example:{port}\r\n\r\n").await;
    assert_eq!(status_of(&rebinding), 421);
    let no_host = ask(port, "GET /index.html HTTP/1.1\r\n\r\n").await;
    assert_eq!(status_of(&no_host), 421);

    for path in ["/../secret", "/%2e%2e/secret", "/a/%2E/b", "//x", "/a%00b", "/a%5cb", "/a\\b", "relative"] {
        let answer = ask(port, &get(path)).await;
        assert_eq!(status_of(&answer), 404, "{path}");
    }
    let long = format!("/{}", "a".repeat(2048));
    assert_eq!(status_of(&ask(port, &get(&long)).await), 404);

    let huge = format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{{port}}\r\nX-Pad: {}\r\n\r\n", "p".repeat(17 * 1024));
    assert_eq!(status_of(&ask(port, &huge).await), 431);

    assert!(gateway.seen().is_empty(), "nothing reached the gateway: {:?}", gateway.seen());
}

#[tokio::test]
async fn a_page_without_a_csp_is_refused() {
    let mut reply = page("x");
    reply.headers.retain(|(n, _)| *n != "Content-Security-Policy");
    let gateway = FakeGateway::start(reply).await;
    let (origins, _) = origins_for(&gateway, "PAGE-TOKEN-4").await;
    let port = origins.start_for("acme.reviewer").await.unwrap();
    let answer = ask(port, &get("/index.html")).await;
    assert_eq!(status_of(&answer), 502);
    assert!(answer.contains("Content-Security-Policy"));
}

#[tokio::test]
async fn a_404_passes_and_upstream_failures_become_503_with_retry_after() {
    let mut missing = page("missing");
    missing.status = 404;
    missing.headers.retain(|(n, _)| *n != "Content-Security-Policy");
    let gateway = FakeGateway::start(missing).await;
    let (origins, _) = origins_for(&gateway, "PAGE-TOKEN-5").await;
    let port = origins.start_for("acme.reviewer").await.unwrap();
    assert_eq!(status_of(&ask(port, &get("/nope.js")).await), 404);

    for status in [401u16, 403, 409, 500, 502, 503] {
        let mut failing = page("{}");
        failing.status = status;
        let gateway = FakeGateway::start(failing).await;
        let (origins, _) = origins_for(&gateway, &format!("PAGE-TOKEN-S{status}")).await;
        let port = origins.start_for("acme.reviewer").await.unwrap();
        let answer = ask(port, &get("/index.html")).await;
        assert_eq!(status_of(&answer), 503, "{status}");
        assert_eq!(header(&answer, "retry-after"), Some("2"), "{status}");
        assert!(answer.ends_with("try again\n"), "a one-line text body: {answer}");
    }

    let dead = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}", dead.local_addr().unwrap().port());
    drop(dead);
    let origins = PageOrigins::new(Arc::new(Hooks { gateway: url, home: home("PAGE-TOKEN-DEAD") }), CloudHttp::direct());
    let port = origins.start_for("acme.reviewer").await.unwrap();
    assert_eq!(status_of(&ask(port, &get("/index.html")).await), 503, "a network failure");
}

#[tokio::test]
async fn an_over_size_body_is_cut_and_a_known_one_refused() {
    let big = (MAX_PAGE_BYTES as usize) + 1024 * 1024;
    let mut streamed = page("");
    streamed.body = vec![b'a'; big];
    streamed.stream = true;
    let gateway = FakeGateway::start(streamed).await;
    let (origins, _) = origins_for(&gateway, "PAGE-TOKEN-6").await;
    let port = origins.start_for("acme.reviewer").await.unwrap();
    let answer = ask(port, &get("/big.js")).await;
    let body = answer.split_once("\r\n\r\n").unwrap().1;
    assert_eq!(status_of(&answer), 200);
    assert_eq!(body.len() as u64, MAX_PAGE_BYTES, "cut at 32 MiB");

    let mut declared = page("");
    declared.body = vec![b'a'; big];
    let gateway = FakeGateway::start(declared).await;
    let (origins, _) = origins_for(&gateway, "PAGE-TOKEN-7").await;
    let port = origins.start_for("acme.reviewer").await.unwrap();
    assert_eq!(status_of(&ask(port, &get("/big.js")).await), 502, "a Content-Length over the cap is refused up front");
}

#[tokio::test]
async fn one_port_per_extension_kept_until_stop_all_closes_them() {
    let gateway = FakeGateway::start(page("x")).await;
    let (origins, _) = origins_for(&gateway, "PAGE-TOKEN-8").await;
    let a = origins.start_for("acme.reviewer").await.unwrap();
    assert_eq!(origins.start_for("acme.reviewer").await.unwrap(), a, "the same port twice");
    let b = origins.start_for("acme.other").await.unwrap();
    assert_ne!(a, b, "one origin per extension");
    assert!(origins.start_for("Not.An.Id").await.is_err());
    assert!(origins.start_for("noperiod").await.is_err());
    origins.stop_all();
    assert_eq!(origins.running(), 0);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(TcpStream::connect(("127.0.0.1", a)).await.is_err(), "the port is closed");
    assert!(TcpStream::connect(("127.0.0.1", b)).await.is_err());
    let again = origins.start_for("acme.reviewer").await.unwrap();
    assert_ne!(again, 0);
}

#[tokio::test]
async fn the_log_names_the_extension_and_the_status_never_the_token_or_path() {
    let gateway = FakeGateway::start(page("x")).await;
    let (origins, _) = origins_for(&gateway, "LOG-PAGE-SECRET").await;
    let port = origins.start_for("acme.reviewer").await.unwrap();
    ask(port, &get("/private-file-name.js")).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    let lines: Vec<String> = crate::cloud::log::captured().into_iter().filter(|l| l.starts_with("igni pages:")).collect();
    assert!(lines.iter().any(|l| l.contains("acme.reviewer") && l.contains("200")), "{lines:?}");
    for line in crate::cloud::log::captured() {
        assert!(!line.contains("LOG-PAGE-SECRET"), "{line}");
        assert!(!line.contains("private-file-name"), "{line}");
    }
}

#[test]
fn extension_ids_follow_igni_core() {
    for ok in ["acme.reviewer", "a.b", "acme2.code-index", "x.y.z-9"] {
        assert!(extension_id_ok(ok), "{ok}");
    }
    for bad in ["", "acme", "Acme.reviewer", "1acme.x", "acme.", "acme..x", "acme.-x", "acme.x_y", "acme.x/y", "../x.y"] {
        assert!(!extension_id_ok(bad), "{bad}");
    }
}

#[test]
fn the_path_rules() {
    for ok in ["/", "/index.html", "/assets/app.js", "/a%20b.png", "/a.b/c"] {
        assert!(page_path_ok(ok), "{ok}");
    }
    for bad in ["", "x", "/..", "/a/../b", "/%2e%2e", "/%2E%2e/x", "/./a", "/a/.", "//", "/a//b", "/a%2f%2fb", "/%00", "/a%5Cb", "/a%zz", "/a%2"] {
        assert!(!page_path_ok(bad), "{bad}");
    }
}
