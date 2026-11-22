//! Dialling the gateway: TCP (through the environment's proxy when one
//! applies), TLS with the platform's roots, then the WebSocket upgrade to
//! `/v1/connect` with `Authorization: Bearer <session>` and `igni.v1`.
//!
//! The bearer goes in the header, not the `igni.bearer.<t>` subprotocol a
//! browser would have to use, because Rust can set headers. No `Origin`
//! is sent: the relay is a program, and the gateway's allow-list applies
//! to browsers.

use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::WebSocketStream;

use crate::cloud::gateway::GatewayUrl;
use crate::cloud::net::CloudHttp;
use crate::cloud::session::Session;
use crate::cloud::state::Unreachable;

use super::door::SUBPROTOCOL;

/// How long the TCP connect (and a proxy's CONNECT) may take.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long TLS and the upgrade may take. The gateway answers the upgrade
/// at once and only then wakes the VM, so this is not the wake time.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);

/// Any byte stream the upgrade can run over: plain TCP or TLS on it.
pub(crate) trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

/// A connection to the cloud igni, through the gateway.
pub(crate) type UpstreamSocket = WebSocketStream<Box<dyn Io>>;

/// Why a dial did not reach the cloud igni.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DialError {
    /// 401: the desktop's session expired or was revoked.
    Unauthorized,
    Unreachable(Unreachable),
    /// Refused at the upgrade with a reason (403).
    Refused(String),
}

fn network(why: impl std::fmt::Display) -> DialError {
    DialError::Unreachable(Unreachable::Network(why.to_string()))
}

/// Open the gateway's WebSocket for `session`.
pub(crate) async fn dial(gateway: &GatewayUrl, session: &Session, http: &CloudHttp) -> Result<UpstreamSocket, DialError> {
    let tcp = tokio::time::timeout(CONNECT_TIMEOUT, connect_tcp(gateway, http))
        .await
        .map_err(|_| network("connect timed out"))??;
    let io: Box<dyn Io> = if gateway.tls() {
        Box::new(tokio::time::timeout(HANDSHAKE_TIMEOUT, tls(gateway, tcp, http)).await.map_err(|_| network("TLS timed out"))??)
    } else {
        Box::new(tcp)
    };
    let mut request = gateway.connect_url(false).into_client_request().map_err(network)?;
    let headers = request.headers_mut();
    headers.insert("authorization", HeaderValue::from_str(&session.token.bearer()).map_err(|_| DialError::Unauthorized)?);
    headers.insert("sec-websocket-protocol", HeaderValue::from_static(SUBPROTOCOL));
    match tokio::time::timeout(HANDSHAKE_TIMEOUT, tokio_tungstenite::client_async(request, io)).await {
        Err(_) => Err(network("upgrade timed out")),
        Ok(Ok((socket, _))) => Ok(socket),
        Ok(Err(e)) => Err(classify(e)),
    }
}

/// Read a failed upgrade.
pub(crate) fn classify(error: WsError) -> DialError {
    match error {
        WsError::Http(response) => {
            let status = response.status().as_u16();
            let body = response
                .body()
                .as_ref()
                .map(|b| String::from_utf8_lossy(b).into_owned())
                .unwrap_or_default();
            match status {
                401 => DialError::Unauthorized,
                // `not_a_person` (§15.2) cannot happen for a desktop session;
                // if it does, it is a refusal like any other.
                403 => DialError::Refused(refusal_reason(&body)),
                503 => network("the gateway is unavailable (503)"),
                other => network(format!("the gateway answered {other}")),
            }
        }
        WsError::Io(e) => network(e),
        other => network(other),
    }
}

/// The reason in a 403's body: `{"reason": …}`, `{"error": …}`, or text.
fn refusal_reason(body: &str) -> String {
    let parsed = serde_json::from_str::<serde_json::Value>(body).ok();
    let reason = parsed
        .as_ref()
        .and_then(|v| v.get("reason").or_else(|| v.get("error")))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| body.trim().to_string());
    super::close::reason_token(&reason)
}

pub(crate) async fn connect_tcp(gateway: &GatewayUrl, http: &CloudHttp) -> Result<TcpStream, DialError> {
    match http.proxy.for_host(gateway.host(), gateway.tls()) {
        None => TcpStream::connect((gateway.host(), gateway.port())).await.map_err(network),
        Some(through) => {
            let stream = TcpStream::connect((through.host.as_str(), through.port)).await.map_err(network)?;
            tunnel(stream, &gateway.authority()).await
        }
    }
}

/// `CONNECT authority` through an HTTP proxy; the stream then carries
/// TLS end to end, so the proxy sees the host and nothing else.
pub(crate) async fn tunnel(mut stream: TcpStream, authority: &str) -> Result<TcpStream, DialError> {
    stream
        .write_all(format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n").as_bytes())
        .await
        .map_err(network)?;
    let mut reader = BufReader::new(stream);
    let mut status = String::new();
    reader.read_line(&mut status).await.map_err(network)?;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await.map_err(network)? == 0 || line == "\r\n" || line == "\n" {
            break;
        }
    }
    let ok = status.split_whitespace().nth(1) == Some("200");
    if !ok {
        return Err(network(format!("the proxy refused the tunnel ({})", status.trim())));
    }
    Ok(reader.into_inner())
}

pub(crate) async fn tls(
    gateway: &GatewayUrl,
    tcp: TcpStream,
    http: &CloudHttp,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>, DialError> {
    let config = http.tls.clone();
    let name = rustls::pki_types::ServerName::try_from(gateway.host().to_string())
        .map_err(|_| network("the gateway's host is not a valid name"))?;
    TlsConnector::from(config).connect(name, tcp).await.map_err(tls_error)
}

/// A TLS failure: a certificate problem is told apart, because it is the
/// one a person (or their IT) must fix and that is never bypassed.
pub(crate) fn tls_error(error: std::io::Error) -> DialError {
    let certificate = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<rustls::Error>())
        .map(|e| matches!(e, rustls::Error::InvalidCertificate(_) | rustls::Error::NoCertificatesPresented))
        .unwrap_or(false);
    if certificate {
        DialError::Unreachable(Unreachable::Certificate(error.to_string()))
    } else {
        network(format!("TLS: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::http::Response;

    fn http_error(status: u16, body: &str) -> WsError {
        let mut response = Response::new(Some(body.as_bytes().to_vec()));
        *response.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::from_u16(status).unwrap();
        WsError::Http(Box::new(response))
    }

    #[test]
    fn a_refused_upgrade_is_read_by_status() {
        assert_eq!(classify(http_error(401, "")), DialError::Unauthorized);
        assert_eq!(classify(http_error(403, r#"{"reason":"group_local_only: moved"}"#)), DialError::Refused("group_local_only".into()));
        assert_eq!(classify(http_error(403, "inactive")), DialError::Refused("inactive".into()));
        assert_eq!(
            classify(http_error(403, r#"{"error":"not_a_person","error_description":"only a person's desktop hosts extension pages"}"#)),
            DialError::Refused("not_a_person".into())
        );
        assert!(matches!(classify(http_error(503, "")), DialError::Unreachable(Unreachable::Network(_))));
        assert!(matches!(classify(http_error(502, "")), DialError::Unreachable(Unreachable::Network(_))));
        assert!(matches!(
            classify(WsError::Io(std::io::Error::other("reset"))),
            DialError::Unreachable(Unreachable::Network(_))
        ));
    }

    #[test]
    fn a_bad_certificate_is_its_own_failure() {
        let cert = std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            rustls::Error::InvalidCertificate(rustls::CertificateError::UnknownIssuer),
        );
        assert!(matches!(tls_error(cert), DialError::Unreachable(Unreachable::Certificate(_))));
        let other = std::io::Error::new(std::io::ErrorKind::InvalidData, rustls::Error::DecryptError);
        assert!(matches!(tls_error(other), DialError::Unreachable(Unreachable::Network(_))));
        assert!(matches!(tls_error(std::io::Error::other("eof")), DialError::Unreachable(Unreachable::Network(_))));
    }

    #[tokio::test]
    async fn a_proxy_tunnel_sends_connect_and_needs_a_200() {
        use tokio::io::AsyncReadExt;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let proxy = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 256];
            let n = s.read(&mut buf).await.unwrap();
            s.write_all(b"HTTP/1.1 200 Connection established\r\nX: y\r\n\r\n").await.unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        let stream = TcpStream::connect(addr).await.unwrap();
        tunnel(stream, "gw.example:443").await.unwrap();
        let sent = proxy.await.unwrap();
        assert!(sent.starts_with("CONNECT gw.example:443 HTTP/1.1\r\nHost: gw.example:443\r\n"), "{sent}");

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 256];
            let _ = s.read(&mut buf).await;
            let _ = s.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n").await;
        });
        let stream = TcpStream::connect(addr).await.unwrap();
        assert!(matches!(tunnel(stream, "gw.example:443").await, Err(DialError::Unreachable(Unreachable::Network(_)))));
    }
}
