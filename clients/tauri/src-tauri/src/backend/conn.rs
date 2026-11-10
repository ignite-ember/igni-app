//! What a window needs to reach the running backend.

use crate::backend::WsToken;
use crate::runtime::{BackendInstall, IGNI_CORE_VERSION};

/// The backend versions the web bundle's `BackendVersionChip` renders.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BackendVersionInfo {
    pub actual: Option<String>,
    pub expected: String,
    pub source: &'static str,
}

impl BackendVersionInfo {
    /// A backend another client started, reporting its wire version.
    pub fn discovered(wire_version: String) -> Self {
        BackendVersionInfo {
            actual: Some(wire_version),
            expected: IGNI_CORE_VERSION.to_string(),
            source: "discovered",
        }
    }
}

impl From<&BackendInstall> for BackendVersionInfo {
    fn from(install: &BackendInstall) -> Self {
        BackendVersionInfo {
            actual: install.actual_cli_version.clone(),
            expected: install.expected_cli_version.clone(),
            source: install.source.as_str(),
        }
    }
}

/// Published once bootstrap resolves; every later window connects to the
/// same backend instead of bootstrapping again.
#[derive(Clone)]
pub(crate) struct BackendConn {
    port: u16,
    /// `None` only for a backend that requires no token (one an IDE
    /// plugin or a developer started, or the debug-build dev switch).
    ws_token: Option<WsToken>,
    version: BackendVersionInfo,
}

impl BackendConn {
    pub fn new(port: u16, ws_token: Option<WsToken>, version: BackendVersionInfo) -> Self {
        BackendConn {
            port,
            ws_token,
            version,
        }
    }

    /// The URL a window loads to reach the backend.
    ///
    /// `project_dir` is set only for a window opened onto a folder of its
    /// own (New Window). The first window omits it and resumes the
    /// backend's default session, which is already the launch folder.
    /// The token rides in the fragment: it never reaches a server or a
    /// request log, and it survives the webview reloading.
    pub fn app_url(&self, project_dir: Option<&str>) -> String {
        let ws = percent_encode(&format!("ws://127.0.0.1:{}", self.port));
        let actual = self.version.actual.as_deref().unwrap_or("unknown");
        let mut url = format!(
            "index.html?ws={ws}&host=tauri&expected_cli={}&actual_cli={actual}&backend_source={}",
            self.version.expected, self.version.source
        );
        if let Some(dir) = project_dir {
            url.push_str(&format!("&dir={}", percent_encode(dir)));
        }
        if let Some(token) = &self.ws_token {
            url.push_str(&format!(
                "#igni_ws_token={}",
                percent_encode(token.as_str())
            ));
        }
        url
    }
}

/// Percent-encode one query-string value: RFC 3986 unreserved characters
/// pass, every other byte becomes `%XX`. Project paths contain spaces and
/// may contain `&`, `#` or `%`, any of which would truncate the URL.
pub(crate) fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(ws_token: Option<&str>) -> BackendConn {
        BackendConn::new(
            51234,
            ws_token.map(|t| WsToken::from(t.to_string())),
            BackendVersionInfo {
                actual: Some("1.0.3".into()),
                expected: "1.0.3".into(),
                source: "managed_venv",
            },
        )
    }

    #[test]
    fn the_first_window_gets_no_dir_param() {
        // A `dir` here would attach a second session to the launch folder.
        let url = conn(None).app_url(None);
        assert!(!url.contains("&dir="), "unexpected dir param in {url}");
        assert!(url.contains("ws=ws%3A%2F%2F127.0.0.1%3A51234"));
        assert!(url.contains("&host=tauri"));
        assert!(url.contains("&expected_cli=1.0.3"));
        assert!(url.contains("&actual_cli=1.0.3"));
        assert!(url.contains("&backend_source=managed_venv"));
    }

    #[test]
    fn an_unknown_actual_version_says_so() {
        let mut c = conn(None);
        c.version.actual = None;
        assert!(c.app_url(None).contains("&actual_cli=unknown&"));
    }

    #[test]
    fn the_ws_token_rides_in_the_fragment_not_the_query() {
        let url = conn(Some("abc-_123")).app_url(Some("/Users/dev/repo"));
        let (query, fragment) = url.split_once('#').expect("a fragment");
        assert!(
            !query.contains("abc-_123"),
            "token leaked into the query: {url}"
        );
        assert_eq!(fragment, "igni_ws_token=abc-_123");
        assert!(query.contains("&dir=%2FUsers%2Fdev%2Frepo"));
        assert!(!conn(None).app_url(None).contains('#'));
    }

    #[test]
    fn a_new_window_carries_its_folder() {
        let url = conn(None).app_url(Some("/Users/dev/repo"));
        assert!(url.contains("&dir=%2FUsers%2Fdev%2Frepo"), "got {url}");
    }

    #[test]
    fn paths_with_spaces_and_specials_survive() {
        // An unencoded `&` or `#` would bind the window to a prefix of the
        // path the user picked.
        let url = conn(None).app_url(Some("/Users/dev/my repo&stuff#1"));
        assert!(
            url.contains("&dir=%2FUsers%2Fdev%2Fmy%20repo%26stuff%231"),
            "got {url}"
        );
    }

    #[test]
    fn encoding_leaves_unreserved_characters_alone() {
        assert_eq!(percent_encode("Az0-_.~"), "Az0-_.~");
        assert_eq!(percent_encode("é"), "%C3%A9");
    }

    #[test]
    fn a_discovered_backend_reports_its_wire_version() {
        let v = BackendVersionInfo::discovered("1.0.2".into());
        assert_eq!(v.actual.as_deref(), Some("1.0.2"));
        assert_eq!(v.expected, IGNI_CORE_VERSION);
        assert_eq!(v.source, "discovered");
    }
}
