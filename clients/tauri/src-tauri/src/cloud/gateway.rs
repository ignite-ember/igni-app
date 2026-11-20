//! The Fleet gateway's address, and whether the session token may go there.
//!
//! igni-core's rule is that igni server's token goes only to the origin of
//! `api_url`. The relay extends that to exactly one more origin: the
//! `gateway_url` that `api_url` itself returned over verified TLS
//! (`/v1/me/cloud`). It must be `https`. A plain-`http` gateway is refused
//! outside a debug build; a debug build accepts one only with
//! `IGNI_DEV_GATEWAY_INSECURE=1`, following `IGNI_DEV_NO_WS_TOKEN`, for a
//! lab gateway without TLS. That switch never turns certificate checks off:
//! an `https` gateway is always verified. A managed `fleet.gateway_url`
//! pins the gateway, and a discovered address that differs is refused.

use std::fmt;

use tauri::Url;

/// Development only: allow a plain-`http` gateway.
pub(crate) const DEV_INSECURE_ENV: &str = "IGNI_DEV_GATEWAY_INSECURE";

/// Why a gateway address is refused. The text is person-facing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum GatewayError {
    Invalid(String),
    NotHttps,
    PinMismatch { pinned: String },
}

impl fmt::Display for GatewayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GatewayError::Invalid(why) => write!(f, "the cloud gateway's address is not a URL ({why})"),
            GatewayError::NotHttps => f.write_str("the cloud gateway does not use https, so igni will not send your session to it"),
            GatewayError::PinMismatch { pinned } => {
                write!(f, "the cloud gateway igni server named is not the one this computer is set to use ({pinned})")
            }
        }
    }
}

/// A gateway address the token may be sent to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GatewayUrl {
    tls: bool,
    host: String,
    port: u16,
    /// Any path prefix the gateway is served under, without a trailing `/`.
    path: String,
}

impl GatewayUrl {
    /// Whether this build lets a plain-`http` gateway through: a debug
    /// build with `IGNI_DEV_GATEWAY_INSECURE=1`. A release build never.
    pub fn insecure_allowed(env_value: Option<&str>) -> bool {
        cfg!(debug_assertions) && env_value.map(str::trim) == Some("1")
    }

    /// The process's own answer to [`GatewayUrl::insecure_allowed`].
    pub fn insecure_allowed_here() -> bool {
        Self::insecure_allowed(std::env::var(DEV_INSECURE_ENV).ok().as_deref())
    }

    /// Check `raw` as a gateway the token may go to.
    pub fn parse(raw: &str, allow_insecure: bool) -> Result<Self, GatewayError> {
        let url = Url::parse(raw.trim()).map_err(|e| GatewayError::Invalid(e.to_string()))?;
        let tls = match url.scheme() {
            "https" => true,
            "http" if allow_insecure => {
                eprintln!(
                    "WARNING: {DEV_INSECURE_ENV}=1 — the cloud relay sends your session to a gateway \
                     without TLS. Development only."
                );
                false
            }
            "http" => return Err(GatewayError::NotHttps),
            other => return Err(GatewayError::Invalid(format!("scheme {other}"))),
        };
        if !url.username().is_empty() || url.password().is_some() {
            return Err(GatewayError::Invalid("credentials in the address".into()));
        }
        let host = url
            .host_str()
            .filter(|h| !h.is_empty())
            .ok_or_else(|| GatewayError::Invalid("no host".into()))?
            .to_ascii_lowercase();
        let port = url.port_or_known_default().unwrap_or(if tls { 443 } else { 80 });
        Ok(GatewayUrl {
            tls,
            host,
            port,
            path: url.path().trim_end_matches('/').to_string(),
        })
    }

    /// Refuse a gateway other than the one a managed setting pins. The
    /// pin is compared as a gateway address, so a trailing slash or the
    /// default port does not count as a difference.
    pub fn check_pin(&self, pin: Option<&str>) -> Result<(), GatewayError> {
        let Some(pin) = pin.map(str::trim).filter(|p| !p.is_empty()) else {
            return Ok(());
        };
        match GatewayUrl::parse(pin, true) {
            Ok(pinned) if pinned == *self => Ok(()),
            _ => Err(GatewayError::PinMismatch { pinned: pin.to_string() }),
        }
    }

    pub fn tls(&self) -> bool {
        self.tls
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// `scheme://host[:port][/prefix]`, the form keys and logs use.
    pub fn base(&self) -> String {
        let scheme = if self.tls { "https" } else { "http" };
        let default = if self.tls { 443 } else { 80 };
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        if self.port == default {
            format!("{scheme}://{host}{}", self.path)
        } else {
            format!("{scheme}://{host}:{}{}", self.port, self.path)
        }
    }

    /// An HTTP route on the gateway, e.g. `/v1/me`.
    pub fn http(&self, route: &str) -> String {
        format!("{}{route}", self.base())
    }

    /// The WebSocket the relay dials: `wss://…/v1/connect?pages=1`, with
    /// `&sign_in=1` when the VM is to be signed in on this connection.
    /// Every window connection hosts extension pages (§15.2), so `pages=1`
    /// is always asked for.
    pub fn connect_url(&self, sign_in: bool) -> String {
        let base = self.base();
        let ws = if self.tls { base.replacen("https://", "wss://", 1) } else { base.replacen("http://", "ws://", 1) };
        let sign_in = if sign_in { "&sign_in=1" } else { "" };
        format!("{ws}/v1/connect?pages=1{sign_in}")
    }

    /// `host:port`, for the TCP dial and a proxy's CONNECT.
    pub fn authority(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }

    /// The window storage key for this gateway and account:
    /// `cloud-<first 12 hex of sha256(gateway_url|org|sub)>`. Hashed, so a
    /// second account or gateway never collides and no address is written
    /// in clear to the webview's storage.
    pub fn backend_key(&self, org: &str, sub: &str) -> String {
        let digest = ring::digest::digest(&ring::digest::SHA256, format!("{}|{org}|{sub}", self.base()).as_bytes());
        let hex: String = digest.as_ref().iter().take(6).map(|b| format!("{b:02x}")).collect();
        format!("cloud-{hex}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_https_gateway_is_accepted_and_its_routes_follow() {
        let gw = GatewayUrl::parse("https://Fleet.Acme.example/", false).unwrap();
        assert!(gw.tls());
        assert_eq!(gw.base(), "https://fleet.acme.example");
        assert_eq!(gw.connect_url(false), "wss://fleet.acme.example/v1/connect?pages=1");
        assert_eq!(gw.connect_url(true), "wss://fleet.acme.example/v1/connect?pages=1&sign_in=1");
        assert_eq!(gw.http("/v1/me"), "https://fleet.acme.example/v1/me");
        assert_eq!(gw.authority(), "fleet.acme.example:443");
    }

    #[test]
    fn a_port_and_a_prefix_are_kept() {
        let gw = GatewayUrl::parse("https://gw.example:8443/fleet/", false).unwrap();
        assert_eq!(gw.connect_url(false), "wss://gw.example:8443/fleet/v1/connect?pages=1");
        assert_eq!(gw.authority(), "gw.example:8443");
    }

    #[test]
    fn plain_http_is_refused_unless_a_debug_build_allows_it() {
        assert_eq!(GatewayUrl::parse("http://lab.example:8080", false).unwrap_err(), GatewayError::NotHttps);
        let lab = GatewayUrl::parse("http://lab.example:8080", true).unwrap();
        assert!(!lab.tls());
        assert_eq!(lab.connect_url(false), "ws://lab.example:8080/v1/connect?pages=1");
    }

    #[test]
    fn the_insecure_switch_is_debug_only_and_needs_exactly_one() {
        assert_eq!(GatewayUrl::insecure_allowed(Some("1")), cfg!(debug_assertions));
        assert!(!GatewayUrl::insecure_allowed(Some("true")));
        assert!(!GatewayUrl::insecure_allowed(Some("0")));
        assert!(!GatewayUrl::insecure_allowed(None));
    }

    #[test]
    fn other_schemes_credentials_and_garbage_are_refused() {
        assert!(matches!(GatewayUrl::parse("wss://gw.example", true), Err(GatewayError::Invalid(_))));
        assert!(matches!(GatewayUrl::parse("ftp://gw.example", true), Err(GatewayError::Invalid(_))));
        assert!(matches!(GatewayUrl::parse("https://u:p@gw.example", false), Err(GatewayError::Invalid(_))));
        assert!(matches!(GatewayUrl::parse("not a url", false), Err(GatewayError::Invalid(_))));
    }

    #[test]
    fn a_pin_refuses_any_other_gateway() {
        let gw = GatewayUrl::parse("https://fleet.acme.example", false).unwrap();
        assert!(gw.check_pin(None).is_ok());
        assert!(gw.check_pin(Some("  ")).is_ok());
        assert!(gw.check_pin(Some("https://fleet.acme.example:443/")).is_ok());
        assert_eq!(
            gw.check_pin(Some("https://other.example")).unwrap_err(),
            GatewayError::PinMismatch { pinned: "https://other.example".into() }
        );
        assert!(gw.check_pin(Some("garbage")).is_err());
    }

    #[test]
    fn the_backend_key_is_hashed_and_differs_per_account_and_gateway() {
        let gw = GatewayUrl::parse("https://fleet.acme.example", false).unwrap();
        let key = gw.backend_key("o1", "p1");
        assert!(key.starts_with("cloud-"));
        assert_eq!(key.len(), "cloud-".len() + 12);
        assert!(!key.contains("acme"));
        assert_eq!(key, gw.backend_key("o1", "p1"));
        assert_ne!(key, gw.backend_key("o1", "p2"));
        assert_ne!(key, gw.backend_key("o2", "p1"));
        let other = GatewayUrl::parse("https://fleet.other.example", false).unwrap();
        assert_ne!(key, other.backend_key("o1", "p1"));
        // sha256("https://fleet.acme.example|o1|p1"), first six bytes.
        let digest = ring::digest::digest(&ring::digest::SHA256, b"https://fleet.acme.example|o1|p1");
        let expected: String = digest.as_ref()[..6].iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(key, format!("cloud-{expected}"));
    }
}
