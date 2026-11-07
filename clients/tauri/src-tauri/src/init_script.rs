//! The script every page load runs first (`loading.html` and the chat UI).
//!
//! In order, `init_script.js`: stamps `data-host="tauri"` and
//! `data-platform` on `<html>` for the host-aware CSS; exposes
//! `window.__IGNI_PICK_DIR__` and the `window.__IGNI_HOST__` bridges
//! (`openFile`, `revealInFolder`, `notify`, `setAppTitle`, `openUrl`);
//! routes external links and `window.open` to the OS; and bridges the
//! `igni-menu` and `igni-fullscreen` events into the page.

/// The real target OS, so the FE need not sniff WKWebView's user agent,
/// which varies across macOS versions.
#[cfg(target_os = "macos")]
const PLATFORM: &str = "mac";
#[cfg(target_os = "windows")]
const PLATFORM: &str = "win";
#[cfg(target_os = "linux")]
const PLATFORM: &str = "linux";

pub(crate) struct InitScript;

impl InitScript {
    /// The script body; `__PLATFORM__` is replaced rather than formatted
    /// in, which would mean escaping every brace in the JS.
    const TEMPLATE: &'static str = include_str!("init_script.js");

    pub fn for_platform() -> String {
        Self::TEMPLATE.replace("__PLATFORM__", PLATFORM)
    }
}

#[cfg(test)]
mod tests {
    // The interceptor runs inside the webview, out of cargo's reach. What
    // these pin is the contract the text must honour for it to work at
    // all: the command name, the capture phase, the scheme allowlist, the
    // `window.open` shim and the `openUrl` bridge.

    use super::*;

    const SCRIPT: &str = InitScript::TEMPLATE;

    #[test]
    fn the_platform_token_is_replaced() {
        let script = InitScript::for_platform();
        assert!(!script.contains("__PLATFORM__"));
        assert!(script.contains(&format!("html.dataset.platform = '{PLATFORM}';")));
    }

    #[test]
    fn init_script_invokes_opener_open_url_command() {
        // The capability is useless if the JS calls another command name.
        assert!(SCRIPT.contains("plugin:opener|open_url"));
    }

    #[test]
    fn init_script_intercepts_clicks_at_capture_phase() {
        // Without the capture-phase `true`, React handlers can consume the
        // click first and the webview navigates to the link itself.
        assert!(SCRIPT.contains("'click'"), "must register a click handler");
        assert!(
            SCRIPT.contains("addEventListener(\n    'click',"),
            "click listener must use capture phase"
        );
        assert!(
            SCRIPT.contains("true\n  );"),
            "the listener's third arg must be the literal `true`"
        );
    }

    #[test]
    fn init_script_allowlist_covers_http_https_mailto_tel() {
        for scheme in ["http://", "https://", "mailto:", "tel:"] {
            assert!(
                SCRIPT.contains(&format!("'{scheme}'")),
                "isExternal() must match `{scheme}`"
            );
        }
        // Routing these would leak local paths or sandbox content to a browser.
        for forbidden in ["ftp://", "file://", "data:"] {
            assert!(
                !SCRIPT.contains(&format!("'{forbidden}'")),
                "isExternal() must NOT route `{forbidden}`"
            );
        }
    }

    #[test]
    fn init_script_shims_window_open() {
        // Through the same opener as the anchor handler.
        assert!(SCRIPT.contains("window.open = function"));
        assert!(SCRIPT.contains("openExternalUrl(url)"));
    }

    #[test]
    fn init_script_exposes_openurl_on_ember_host() {
        // `host.openUrl` in the FE; the welcome screen's sign-in link uses it.
        assert!(SCRIPT.contains("openUrl: openExternalUrl"));
    }

    #[test]
    fn init_script_respects_default_prevented_and_left_button_only() {
        assert!(SCRIPT.contains("e.defaultPrevented"));
        assert!(SCRIPT.contains("e.button !== 0"));
    }

    #[test]
    fn init_script_walks_event_path_for_nested_anchor() {
        // An icon inside an `<a>` is the event target, not the anchor.
        assert!(SCRIPT.contains("composedPath"));
        assert!(SCRIPT.contains("tagName === 'A'"));
    }
}
