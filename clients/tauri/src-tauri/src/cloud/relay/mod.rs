//! The loopback relay: windows connect to it exactly as they connect to a
//! local backend, and it dials the person's cloud igni through the Fleet
//! gateway with the desktop's session token (§3.1).
//!
//! - **Windows see a local backend.** It listens on `127.0.0.1` on a port
//!   the OS picks, behind its own per-launch token and the backend's
//!   Origin rule ([`door`]). Switching a window to the cloud is pointing
//!   its `ws=` here; the CSP stays loopback-only.
//! - **One upstream per window connection**, so each window keeps its own
//!   `client_id` and window model, as locally.
//! - **Re-dialling is the refresh.** The gateway and the session are read
//!   on every dial ([`RelayHooks::target`]), never cached beyond one
//!   connection. A sign-in or sign-out closes every upstream
//!   ([`Relay::close_all`]) and the windows reconnect through their own
//!   backoff.
//! - **Backoff is the relay's.** After a failed dial the next window
//!   connection is held open, with no `welcome`, until the backoff
//!   (1 s doubling to 30 s) has passed or the person asks to retry, so
//!   however fast a window reconnects the gateway is asked at this pace.
//! - **Frames pass unchanged.** Only igni's `welcome` and the
//!   `vm_credential` push are read on the way, for the shell's state.
//! - **Logs** name the gateway host and close codes only; never the token.

pub(crate) mod close;
pub(crate) mod dial;
pub(crate) mod door;
pub(crate) mod frames;

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Notify};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use crate::backend::WsToken;
use crate::cloud::gateway::GatewayUrl;
use crate::cloud::log;
use crate::cloud::net::CloudHttp;
use crate::cloud::session::Session;
use crate::cloud::state::CredentialPush;

use close::{Upstream, CLOSE_GOING_AWAY, CLOSE_RESTART};
use dial::DialError;
use frames::Seen;

/// The first wait after a failed dial, and the longest.
const BACKOFF_FIRST: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);

/// What the relay tells the shell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RelayEvent {
    /// The gateway accepted the upgrade.
    Upgraded,
    /// igni's `welcome` passed to a window.
    Welcome,
    Credential(CredentialPush),
    /// A dial failed; the next one is in `retry_in`.
    DialFailed { error: DialError, retry_in: Duration },
    /// An open upstream closed.
    Closed(Upstream),
}

/// The shell side of the relay.
pub(crate) trait RelayHooks: Send + Sync + 'static {
    /// The gateway and session for the next dial, read now.
    fn target(&self) -> Result<(GatewayUrl, Session), DialError>;
    fn event(&self, event: RelayEvent);
}

/// The failed-dial count and when the next dial may go.
#[derive(Default)]
struct Backoff {
    failures: u32,
    next_at: Option<Instant>,
}

impl Backoff {
    fn delay(failures: u32) -> Duration {
        let doubled = BACKOFF_FIRST.saturating_mul(1u32 << failures.saturating_sub(1).min(16));
        doubled.min(BACKOFF_MAX)
    }

    fn failed(&mut self, now: Instant) -> Duration {
        self.failures = self.failures.saturating_add(1);
        let delay = Self::delay(self.failures);
        self.next_at = Some(now + delay);
        delay
    }

    fn succeeded(&mut self) {
        self.failures = 0;
        self.next_at = None;
    }
}

struct Shared {
    token: WsToken,
    hooks: Arc<dyn RelayHooks>,
    http: CloudHttp,
    backoff: Mutex<Backoff>,
    /// Wakes connections held in backoff, for a retry now.
    retry: Notify,
    /// Bumped to close every connection; carries the code to close with.
    closer: watch::Sender<(u64, u16)>,
}

impl Shared {
    fn backoff(&self) -> MutexGuard<'_, Backoff> {
        self.backoff.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// A running relay. Dropping it does not stop the listener; the app keeps
/// one for its whole life and idles it on the local side.
#[derive(Clone)]
pub(crate) struct Relay {
    port: u16,
    shared: Arc<Shared>,
}

impl Relay {
    /// Bind `127.0.0.1:0` and serve until the process exits.
    pub async fn start(hooks: Arc<dyn RelayHooks>, http: CloudHttp) -> std::io::Result<Relay> {
        let token = WsToken::generate().map_err(|e| std::io::Error::other(e.to_string()))?;
        Self::start_with_token(hooks, http, token).await
    }

    pub async fn start_with_token(hooks: Arc<dyn RelayHooks>, http: CloudHttp, token: WsToken) -> std::io::Result<Relay> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let (closer, _) = watch::channel((0u64, CLOSE_RESTART));
        let shared = Arc::new(Shared {
            token,
            hooks,
            http,
            backoff: Mutex::new(Backoff::default()),
            retry: Notify::new(),
            closer,
        });
        let accepting = Arc::clone(&shared);
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        let shared = Arc::clone(&accepting);
                        tokio::spawn(async move { serve(stream, shared).await });
                    }
                    Err(e) => {
                        log::line("relay", format!("accept failed: {e}"));
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }
            }
        });
        Ok(Relay { port, shared })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// The token windows offer as `igni-token.<t>`.
    pub fn token(&self) -> &WsToken {
        &self.shared.token
    }

    /// Close every window connection and its upstream with `code`: 1012
    /// so windows reconnect (a sign-in or sign-out, a credentials change),
    /// 1001 when the side is left.
    pub fn close_all(&self, code: u16) {
        self.shared.closer.send_modify(|(generation, close)| {
            *generation += 1;
            *close = code;
        });
    }

    /// Dial at once: clear the backoff and wake held connections.
    pub fn retry_now(&self) {
        self.shared.backoff().succeeded();
        self.shared.retry.notify_waiters();
    }

    /// How long until the next dial may go, if a failure is pending.
    pub fn retry_in(&self) -> Option<Duration> {
        let next = self.shared.backoff().next_at?;
        Some(next.saturating_duration_since(Instant::now()))
    }
}

async fn close_window(window: &mut WebSocketStream<TcpStream>, code: u16) {
    let _ = window
        .close(Some(CloseFrame {
            code: CloseCode::from(code),
            reason: "".into(),
        }))
        .await;
}

/// One window connection, from the handshake to its close.
async fn serve(stream: TcpStream, shared: Arc<Shared>) {
    let token = shared.token.as_str().to_string();
    let accepted = tokio_tungstenite::accept_hdr_async(stream, move |req: &Request, res: Response| door::check(req, res, &token)).await;
    let Ok(mut window) = accepted else {
        return;
    };
    let mut closer = shared.closer.subscribe();
    closer.mark_unchanged();

    // Held, without a welcome, until the backoff allows the next dial.
    let wait = shared.backoff().next_at;
    if let Some(at) = wait {
        tokio::select! {
            _ = tokio::time::sleep_until(at) => {}
            _ = shared.retry.notified() => {}
            _ = closer.changed() => {
                let code = closer.borrow().1;
                return close_window(&mut window, code).await;
            }
        }
    }

    let target = shared.hooks.target();
    let upstream = match target {
        Ok((gateway, session)) => {
            let dialled = tokio::select! {
                r = dial::dial(&gateway, &session, &shared.http) => Some((r, gateway)),
                _ = closer.changed() => None,
            };
            match dialled {
                None => {
                    let code = closer.borrow().1;
                    return close_window(&mut window, code).await;
                }
                Some((Ok(upstream), gateway)) => {
                    // The backoff is cleared by igni's `welcome`, not by the
                    // upgrade: a gateway that upgrades and then closes 1011
                    // or 1013 is still backed off.
                    log::line("relay", format!("connected to {}", gateway.host()));
                    shared.hooks.event(RelayEvent::Upgraded);
                    upstream
                }
                Some((Err(error), gateway)) => {
                    log::line("relay", format!("dial to {} failed ({})", gateway.host(), dial_failure_label(&error)));
                    return fail(&shared, &mut window, error).await;
                }
            }
        }
        Err(error) => return fail(&shared, &mut window, error).await,
    };
    pump(window, upstream, &shared, closer).await;
}

/// A short label for a failed dial, safe to log.
fn dial_failure_label(error: &DialError) -> String {
    match error {
        DialError::Unauthorized => "401".into(),
        DialError::Refused(reason) => format!("refused {reason}"),
        DialError::Unreachable(why) => why.token().into(),
    }
}

async fn fail(shared: &Shared, window: &mut WebSocketStream<TcpStream>, error: DialError) {
    let retry_in = shared.backoff().failed(Instant::now());
    // A refusal or a dead session is final: the shell re-points the
    // window. Anything else is retried.
    let code = match error {
        DialError::Unauthorized | DialError::Refused(_) => CLOSE_GOING_AWAY,
        DialError::Unreachable(_) => CLOSE_RESTART,
    };
    shared.hooks.event(RelayEvent::DialFailed { error, retry_in });
    close_window(window, code).await;
}

/// Pass frames both ways until either side closes.
async fn pump(
    mut window: WebSocketStream<TcpStream>,
    mut upstream: dial::UpstreamSocket,
    shared: &Shared,
    mut closer: watch::Receiver<(u64, u16)>,
) {
    loop {
        tokio::select! {
            from_window = window.next() => match from_window {
                Some(Ok(Message::Close(frame))) => {
                    let _ = upstream.send(Message::Close(frame)).await;
                    let _ = upstream.close(None).await;
                    return;
                }
                Some(Ok(message @ (Message::Text(_) | Message::Binary(_)))) => {
                    if upstream.send(message).await.is_err() {
                        shared.hooks.event(RelayEvent::Closed(Upstream::Unreachable(
                            crate::cloud::state::Unreachable::Network("the connection dropped".into()),
                        )));
                        return close_window(&mut window, CLOSE_RESTART).await;
                    }
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => {
                    let _ = upstream.close(None).await;
                    return;
                }
            },
            from_cloud = upstream.next() => match from_cloud {
                Some(Ok(Message::Text(text))) => {
                    match frames::classify(text.as_str()) {
                        Seen::Welcome => {
                            shared.backoff().succeeded();
                            shared.hooks.event(RelayEvent::Welcome);
                        }
                        Seen::Credential(push) => shared.hooks.event(RelayEvent::Credential(push)),
                        Seen::Other => {}
                    }
                    if window.send(Message::Text(text)).await.is_err() {
                        let _ = upstream.close(None).await;
                        return;
                    }
                }
                Some(Ok(message @ Message::Binary(_))) => {
                    if window.send(message).await.is_err() {
                        let _ = upstream.close(None).await;
                        return;
                    }
                }
                Some(Ok(Message::Close(frame))) => {
                    let (code, reason) = frame
                        .map(|f| (u16::from(f.code), f.reason.to_string()))
                        .unwrap_or((1005, String::new()));
                    log::line("relay", format!("the gateway closed {code}"));
                    let (meaning, window_code) = close::upstream_closed(code, &reason);
                    if matches!(meaning, Upstream::Unreachable(_)) {
                        shared.backoff().failed(Instant::now());
                    }
                    shared.hooks.event(RelayEvent::Closed(meaning));
                    return close_window(&mut window, window_code).await;
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => {
                    log::line("relay", "the gateway connection dropped");
                    shared.backoff().failed(Instant::now());
                    shared.hooks.event(RelayEvent::Closed(Upstream::Unreachable(
                        crate::cloud::state::Unreachable::Network("the connection dropped".into()),
                    )));
                    return close_window(&mut window, CLOSE_RESTART).await;
                }
            },
            _ = closer.changed() => {
                let code = closer.borrow().1;
                let _ = upstream.close(None).await;
                return close_window(&mut window, code).await;
            }
        }
    }
}

#[cfg(test)]
mod tests;
