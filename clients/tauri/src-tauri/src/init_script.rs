//! The script every page load runs first (`loading.html` and the chat UI).
//!
//! In order, `init_script.js`: stamps `data-host="tauri"` and
//! `data-platform` on `<html>` for the host-aware CSS; exposes
//! `window.__IGNI_PICK_DIR__` and the `window.__IGNI_HOST__` bridges
//! (`openFile`, `revealInFolder`, `notify`, `setAppTitle`, `openUrl`);
//! routes external links and `window.open` to the OS; and bridges the
//! `igni-menu`, `igni-open-link`, `igni-backend-state` and
//! `igni-fullscreen` events into the page once Tauri's API is there.
//!
//! Windows injects this script at document start, where the document's
//! root element does not exist yet, so every read of it is guarded and
//! the shell's listeners wait for Tauri's API rather than assuming it.

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

    /// The script as the checkout gave it, with the line endings
    /// normalised.
    ///
    /// A Windows checkout has CRLF, and the assertions below match the
    /// text literally — so a test that reads "the listener is registered
    /// on a line of its own" would fail on a checkout whose lines end
    /// differently, for a reason that has nothing to do with the script.
    fn script_text() -> String {
        InitScript::TEMPLATE.replace("\r\n", "\n")
    }

    #[test]
    fn the_platform_token_is_replaced() {
        let script = InitScript::for_platform();
        assert!(!script.contains("__PLATFORM__"));
        assert!(script.contains(&format!("html.dataset.platform = '{PLATFORM}';")));
    }

    #[test]
    fn each_window_hears_only_the_events_sent_to_it() {
        // A global listen hears an event emitted to any window (R624).
        assert!(script_text().contains("getCurrentWebviewWindow()"));
        for name in ["igni-menu", "igni-open-link", "igni-fullscreen"] {
            assert!(
                script_text().contains(&format!("listenHere('{name}'")),
                "{name} must be heard on this window only"
            );
            assert!(!script_text().contains(&format!("event.listen('{name}'")));
        }
    }

    #[test]
    fn the_backend_state_is_heard_globally_and_handed_to_the_web_ui() {
        // The switch's side is the app's: every window hears the one
        // broadcast, as an `igni-host` event the web UI listens for.
        let script = script_text();
        assert!(script.contains("event.listen('igni-backend-state'"));
        assert!(!script.contains("listenHere('igni-backend-state'"));
        assert!(script.contains("type: 'igni:backend-state', payload: e && e.payload"));
    }

    #[test]
    fn the_shell_event_listeners_wait_for_tauri_s_global_api() {
        // A one-off check at load registered nothing on Windows, where the
        // script can run before `window.__TAURI__` exists (R624). The
        // behaviour is tested in clients/web/src/lib/initScript.test.ts.
        let script = script_text();
        assert!(!script.contains("if (window.__TAURI__ && window.__TAURI__.event) {"));
        let wait = script
            .find("whenTauriEvents(() => {")
            .expect("listeners registered through the wait");
        for name in ["igni-menu", "igni-open-link", "igni-fullscreen"] {
            let at = script.find(&format!("listenHere('{name}'")).unwrap();
            assert!(at > wait, "{name} is registered before the wait");
        }
    }

    #[test]
    fn init_script_invokes_opener_open_url_command() {
        // The capability is useless if the JS calls another command name.
        assert!(script_text().contains("plugin:opener|open_url"));
    }

    #[test]
    fn init_script_intercepts_clicks_at_capture_phase() {
        // Without the capture-phase `true`, React handlers can consume the
        // click first and the webview navigates to the link itself.
        assert!(
            script_text().contains("'click'"),
            "must register a click handler"
        );
        assert!(
            script_text().contains("addEventListener(\n    'click',"),
            "click listener must use capture phase"
        );
        assert!(
            script_text().contains("true\n  );"),
            "the listener's third arg must be the literal `true`"
        );
    }

    #[test]
    fn init_script_allowlist_covers_http_https_mailto_tel() {
        for scheme in ["http://", "https://", "mailto:", "tel:"] {
            assert!(
                script_text().contains(&format!("'{scheme}'")),
                "isExternal() must match `{scheme}`"
            );
        }
        // Routing these would leak local paths or sandbox content to a browser.
        for forbidden in ["ftp://", "file://", "data:"] {
            assert!(
                !script_text().contains(&format!("'{forbidden}'")),
                "isExternal() must NOT route `{forbidden}`"
            );
        }
    }

    #[test]
    fn init_script_shims_window_open() {
        // Through the same opener as the anchor handler.
        assert!(script_text().contains("window.open = function"));
        assert!(script_text().contains("openExternalUrl(url)"));
    }

    #[test]
    fn init_script_exposes_openurl_on_ember_host() {
        // `host.openUrl` in the FE; the welcome screen's sign-in link uses it.
        assert!(script_text().contains("openUrl: openExternalUrl"));
    }

    #[test]
    fn init_script_respects_default_prevented_and_left_button_only() {
        assert!(script_text().contains("e.defaultPrevented"));
        assert!(script_text().contains("e.button !== 0"));
    }

    #[test]
    fn init_script_walks_event_path_for_nested_anchor() {
        // An icon inside an `<a>` is the event target, not the anchor.
        assert!(script_text().contains("composedPath"));
        assert!(script_text().contains("tagName === 'A'"));
    }

    /// The script must survive a document with no root element.
    ///
    /// Windows injects it at document start, where the root does not
    /// exist yet: reading `document.documentElement` unguarded throws
    /// there, and the throw aborts the whole script — so the window
    /// never registers its listeners and never hears the shell's link
    /// (the Windows deep-link failure). Every read of the root is
    /// guarded, and the listeners wait for Tauri's API rather than
    /// assuming it, so the script runs to the end regardless. The web
    /// client runs this script for real in
    /// clients/web/src/lib/initScript.test.ts.
    #[test]
    fn the_script_survives_a_document_with_no_root_element() {
        let text = script_text();
        assert!(
            text.contains("if (!html) return false;"),
            "the stamp must not touch a root that is not there yet"
        );
        assert!(
            text.contains("if (!document.documentElement) return;"),
            "the fullscreen mirror must not touch a root that is not there yet"
        );
    }
}
