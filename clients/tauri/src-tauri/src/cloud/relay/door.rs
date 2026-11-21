//! The relay's own door: who may open a WebSocket to it.
//!
//! The same model as the backend's handshake (igni-core
//! `transport/ws_auth.py`): a browser always sends `Origin`, so a request
//! with one must come from the webview (`tauri://localhost`,
//! `http(s)://tauri.localhost`) or a loopback page; a request without one
//! is a program. Either way it must offer `igni-token.<t>` with this
//! launch's token, compared in constant time. Without the token a page in
//! the person's browser cannot use the relay to reach their cloud igni.

use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};

/// The subprotocol igni speaks; the relay selects it, as the backend does.
pub(crate) const SUBPROTOCOL: &str = "igni.v1";
/// The offered subprotocol that carries the relay's token.
const TOKEN_PREFIX: &str = "igni-token.";

const TAURI_ORIGINS: [&str; 3] = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];
const LOOPBACK_HOSTS: [&str; 3] = ["127.0.0.1", "localhost", "[::1]"];

/// Whether `origin` may open the relay: absent (a program), the webview,
/// or a loopback page on any port.
pub(crate) fn origin_allowed(origin: Option<&str>) -> bool {
    let Some(origin) = origin else {
        return true;
    };
    let origin = origin.trim().to_ascii_lowercase();
    if TAURI_ORIGINS.contains(&origin.as_str()) {
        return true;
    }
    let Some(rest) = origin.strip_prefix("http://").or_else(|| origin.strip_prefix("https://")) else {
        return false;
    };
    if rest.contains('/') || rest.contains('@') {
        return false;
    }
    let host = match rest.rfind(':') {
        // `[::1]:5179` or `127.0.0.1:5179`; a bare `[::1]` has no port.
        Some(i) if !rest.ends_with(']') => {
            let (host, port) = rest.split_at(i);
            if !port[1..].chars().all(|c| c.is_ascii_digit()) || port.len() == 1 {
                return false;
            }
            host
        }
        _ => rest,
    };
    LOOPBACK_HOSTS.contains(&host)
}

/// Whether `offered` (the `Sec-WebSocket-Protocol` values) carries
/// `token`, compared in constant time.
pub(crate) fn token_offered(offered: &[&str], token: &str) -> bool {
    offered
        .iter()
        .filter_map(|p| p.trim().strip_prefix(TOKEN_PREFIX))
        .any(|presented| constant_time_eq(presented.as_bytes(), token.as_bytes()))
}

/// Equal bytes, compared without an early exit on the first difference.
/// The length is not secret: every token is 43 characters.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The `Sec-WebSocket-Protocol` values a request offers.
fn offered_protocols(request: &Request) -> Vec<String> {
    request
        .headers()
        .get_all("sec-websocket-protocol")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(',').map(|p| p.trim().to_string()))
        .collect()
}

fn refuse(status: StatusCode, why: &str) -> ErrorResponse {
    let mut response = ErrorResponse::new(Some(why.to_string()));
    *response.status_mut() = status;
    response
}

/// The handshake check: refuse a foreign origin or a missing or wrong
/// token with 403, and select `igni.v1` for a window.
#[allow(clippy::result_large_err)] // tungstenite's own callback type
pub(crate) fn check(request: &Request, response: Response, token: &str) -> Result<Response, ErrorResponse> {
    let origin = request.headers().get("origin").and_then(|v| v.to_str().ok());
    if !origin_allowed(origin) {
        return Err(refuse(StatusCode::FORBIDDEN, "origin not allowed"));
    }
    let offered = offered_protocols(request);
    let offered: Vec<&str> = offered.iter().map(String::as_str).collect();
    if !token_offered(&offered, token) {
        return Err(refuse(StatusCode::FORBIDDEN, "token required"));
    }
    let mut response = response;
    if offered.contains(&SUBPROTOCOL) {
        response
            .headers_mut()
            .insert("sec-websocket-protocol", HeaderValue::from_static(SUBPROTOCOL));
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_webview_loopback_and_programs_may_open_it() {
        for ok in [
            None,
            Some("tauri://localhost"),
            Some("http://tauri.localhost"),
            Some("https://tauri.localhost"),
            Some("http://127.0.0.1:5179"),
            Some("http://localhost:5179"),
            Some("http://localhost"),
            Some("http://[::1]:5179"),
            Some("HTTP://LOCALHOST:1"),
        ] {
            assert!(origin_allowed(ok), "{ok:?}");
        }
    }

    #[test]
    fn any_other_origin_is_refused() {
        for bad in [
            Some("https://evil.example"),
            Some("http://127.0.0.1.evil.example"),
            Some("http://localhost.evil.example:80"),
            Some("http://evil.example@127.0.0.1"),
            Some("http://127.0.0.1:5179/path"),
            Some("http://127.0.0.1:abc"),
            Some("http://127.0.0.1:"),
            Some("null"),
            Some("file://"),
            Some("tauri://evil"),
        ] {
            assert!(!origin_allowed(bad), "{bad:?}");
        }
    }

    #[test]
    fn the_token_must_be_offered_exactly() {
        assert!(token_offered(&["igni.v1", "igni-token.abc"], "abc"));
        assert!(!token_offered(&["igni.v1", "igni-token.abd"], "abc"));
        assert!(!token_offered(&["igni.v1", "igni-token.ab"], "abc"));
        assert!(!token_offered(&["igni.v1"], "abc"));
        assert!(!token_offered(&["abc"], "abc"));
    }
}
