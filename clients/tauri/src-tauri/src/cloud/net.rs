//! How the shell reaches igni server and the gateway over the network:
//! TLS that trusts what the system trusts, and the proxy the environment
//! names.
//!
//! TLS is rustls with the platform verifier, so a certificate an
//! enterprise CA issued is accepted exactly where the system accepts it,
//! and every certificate is checked: there is no switch that turns the
//! check off. `HTTPS_PROXY` (or `HTTP_PROXY` for a debug build's plain
//! gateway) and `NO_PROXY` are honoured, read from the environment of
//! this process.

use std::sync::Arc;

use rustls::ClientConfig;
use rustls_platform_verifier::BuilderVerifierExt as _;

/// A client TLS configuration with the platform's roots. `ws` sets ALPN
/// to HTTP/1.1, which a WebSocket upgrade needs.
pub(crate) fn tls_config(ws: bool) -> Result<Arc<ClientConfig>, rustls::Error> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .with_platform_verifier()?
        .with_no_client_auth();
    if ws {
        config.alpn_protocols = vec![b"http/1.1".to_vec()];
    }
    Ok(Arc::new(config))
}

/// The client settings the relay and the page origins share: rustls with
/// the platform's roots, and the environment's proxy. Built once per cloud
/// side, so both reach the gateway the same way.
#[derive(Clone)]
pub(crate) struct CloudHttp {
    pub tls: Arc<ClientConfig>,
    pub proxy: ProxyConfig,
}

impl CloudHttp {
    pub fn from_env() -> Result<Self, rustls::Error> {
        Ok(CloudHttp {
            tls: tls_config(true)?,
            proxy: ProxyConfig::from_env(),
        })
    }

    #[cfg(test)]
    pub fn direct() -> Self {
        CloudHttp {
            tls: tls_config(true).expect("platform verifier"),
            proxy: ProxyConfig::default(),
        }
    }
}

/// Where a connection goes first when a proxy is set.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProxyTarget {
    pub host: String,
    pub port: u16,
}

impl ProxyTarget {
    pub fn authority(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    /// `http://host:port`, for ureq.
    pub fn url(&self) -> String {
        format!("http://{}", self.authority())
    }
}

/// The proxy settings, as the environment states them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProxyConfig {
    https: Option<ProxyTarget>,
    http: Option<ProxyTarget>,
    no_proxy: Vec<String>,
}

impl ProxyConfig {
    pub fn from_env() -> Self {
        let var = |names: &[&str]| names.iter().find_map(|n| std::env::var(n).ok()).filter(|v| !v.trim().is_empty());
        Self::from_values(
            var(&["HTTPS_PROXY", "https_proxy"]).as_deref(),
            var(&["HTTP_PROXY", "http_proxy"]).as_deref(),
            var(&["NO_PROXY", "no_proxy"]).as_deref(),
        )
    }

    pub fn from_values(https: Option<&str>, http: Option<&str>, no_proxy: Option<&str>) -> Self {
        ProxyConfig {
            https: https.and_then(parse_proxy),
            http: http.and_then(parse_proxy),
            no_proxy: no_proxy
                .unwrap_or("")
                .split(',')
                .map(|e| e.trim().trim_start_matches("*.").trim_start_matches('.').to_ascii_lowercase())
                .map(|e| e.split(':').next().unwrap_or("").to_string())
                .filter(|e| !e.is_empty())
                .collect(),
        }
    }

    /// The proxy for a connection to `host`, or `None` to go direct:
    /// loopback, a `NO_PROXY` match, or no proxy set.
    pub fn for_host(&self, host: &str, tls: bool) -> Option<&ProxyTarget> {
        let host = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
        if matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") {
            return None;
        }
        let excluded = self.no_proxy.iter().any(|entry| {
            entry == "*" || host == *entry || host.ends_with(&format!(".{entry}"))
        });
        if excluded {
            return None;
        }
        if tls {
            self.https.as_ref()
        } else {
            self.http.as_ref()
        }
    }
}

/// `http://[user@]host[:port][/]` to a target; a proxy that is not plain
/// HTTP is not supported and reads as none.
fn parse_proxy(value: &str) -> Option<ProxyTarget> {
    let value = value.trim();
    let with_scheme = if value.contains("://") { value.to_string() } else { format!("http://{value}") };
    let url = tauri::Url::parse(&with_scheme).ok()?;
    if url.scheme() != "http" {
        eprintln!("igni: ignoring a proxy that is not http:// ({})", url.scheme());
        return None;
    }
    Some(ProxyTarget {
        host: url.host_str()?.to_string(),
        port: url.port().unwrap_or(80),
    })
}

/// A ureq agent for igni server and the gateway's HTTP routes: platform
/// TLS, the environment's proxy for `host`, and a bounded wait.
pub(crate) fn http_agent(host: &str, tls: bool) -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .https_only(false);
    match tls_config(false) {
        Ok(config) => builder = builder.tls_config(config),
        Err(e) => eprintln!("igni: the platform's TLS roots are unavailable ({e}); using the bundled ones"),
    }
    if let Some(proxy) = ProxyConfig::from_env().for_host(host, tls) {
        if let Ok(proxy) = ureq::Proxy::new(proxy.url()) {
            builder = builder.proxy(proxy);
        }
    }
    builder.build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_https_proxy_is_used_for_tls_and_the_http_one_otherwise() {
        let config = ProxyConfig::from_values(Some("http://proxy.corp:3128"), Some("plain.corp:8080"), None);
        assert_eq!(config.for_host("gw.example", true).unwrap().authority(), "proxy.corp:3128");
        assert_eq!(config.for_host("gw.example", false).unwrap().authority(), "plain.corp:8080");
    }

    #[test]
    fn no_proxy_and_loopback_go_direct() {
        let config = ProxyConfig::from_values(Some("http://proxy.corp:3128"), None, Some("internal.example, .corp.example,*.lab:9000"));
        assert!(config.for_host("internal.example", true).is_none());
        assert!(config.for_host("gw.internal.example", true).is_none());
        assert!(config.for_host("a.corp.example", true).is_none());
        assert!(config.for_host("x.lab", true).is_none());
        assert!(config.for_host("127.0.0.1", true).is_none());
        assert!(config.for_host("[::1]", true).is_none());
        assert!(config.for_host("notinternal.example", true).is_some(), "a suffix must be a whole label");
        let all = ProxyConfig::from_values(Some("http://proxy.corp:3128"), None, Some("*"));
        assert!(all.for_host("gw.example", true).is_none());
    }

    #[test]
    fn a_proxy_that_is_not_http_is_none() {
        let config = ProxyConfig::from_values(Some("socks5://proxy.corp:1080"), None, None);
        assert!(config.for_host("gw.example", true).is_none());
        assert!(ProxyConfig::default().for_host("gw.example", true).is_none());
    }

    #[test]
    fn the_platform_tls_config_builds_and_a_websocket_asks_for_http1() {
        let ws = tls_config(true).expect("platform verifier");
        assert_eq!(ws.alpn_protocols, vec![b"http/1.1".to_vec()]);
        assert!(tls_config(false).unwrap().alpn_protocols.is_empty());
    }
}
