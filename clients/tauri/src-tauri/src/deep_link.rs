//! `igni://` links: `igni://open?open=<page kind>&<location params>`.
//!
//! The same link a web window's address bar carries (`?open=…`, see the
//! web client's `chat/arrival.ts`), behind a URL scheme the OS hands to
//! this app. Following one opens the app, or brings its window forward,
//! and the window opens the page at that location.
//!
//! **The shell does not decide what a link opens.** It checks that the
//! URL is an `igni://open` link no longer than any address igni writes,
//! holds it, and tells the window; the window takes it
//! (`igni_take_open_link`) and reads it with `Arrivals.fromDeepLink`,
//! exactly the rules a shared web link is read with: the page-kind check,
//! the param caps, an unknown page opening the chat. One reader, so the
//! two kinds of link cannot drift; `deepLinks.cases.json` in the web
//! client is the table both sides are tested against.
//!
//! **Registered with the OS by the bundle**, from `plugins.deep-link` in
//! `tauri.conf.json`: `CFBundleURLTypes` in the macOS `Info.plist`, the
//! installer's registry entry on Windows, `MimeType=x-scheme-handler/igni`
//! in the Linux `.desktop` file. On Windows and Linux a followed link
//! starts a second process with the URL as its argument; the
//! single-instance plugin hands it to the running app instead.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::error::LogOnError;
use crate::events::ShellEvent;
use crate::windows::WindowManager;

/// The scheme, as registered in `tauri.conf.json`.
pub(crate) const SCHEME: &str = "igni";

/// The longest query a link may carry: the web client's
/// `MAX_PLACE_SEARCH`, the longest address it ever writes.
pub(crate) const MAX_QUERY: usize = 2048;

/// The link waiting for a window to take it.
#[derive(Default)]
pub(crate) struct DeepLinks {
    pending: Mutex<Option<String>>,
}

impl DeepLinks {
    /// Is `url` an `igni://open` link the shell takes? Only the shape:
    /// what it opens is the window's question.
    pub fn accepts(url: &str) -> bool {
        let url = url.trim();
        let Some(colon) = url.find(':') else {
            return false;
        };
        if !url[..colon].eq_ignore_ascii_case(SCHEME) {
            return false;
        }
        let rest = &url[colon + 1..];
        let Some(rest) = rest.strip_prefix("//open") else {
            return false;
        };
        let rest = rest.strip_prefix('/').unwrap_or(rest);
        let rest = rest.split('#').next().unwrap_or_default();
        if rest.is_empty() {
            return true;
        }
        rest.starts_with('?') && rest.len() <= MAX_QUERY
    }

    /// Is this launch argument a link rather than a project folder?
    /// On Windows and Linux the OS passes a followed link as `argv[1]`.
    pub fn is_link_arg(arg: &str) -> bool {
        arg.len() > SCHEME.len() + 1
            && arg
                .get(..SCHEME.len() + 1)
                .is_some_and(|head| head.eq_ignore_ascii_case(&format!("{SCHEME}:")))
    }

    /// Hold the last acceptable link of `urls`; `true` when there was one.
    pub fn hold<I: IntoIterator<Item = String>>(&self, urls: I) -> bool {
        let Some(link) = urls.into_iter().filter(|u| Self::accepts(u)).last() else {
            return false;
        };
        if let Ok(mut pending) = self.pending.lock() {
            *pending = Some(link);
        }
        true
    }

    /// The held link, given out once.
    pub fn take(&self) -> Option<String> {
        self.pending.lock().ok().and_then(|mut pending| pending.take())
    }

    /// Links the OS handed over while the app runs: hold the last one,
    /// bring a window forward, and tell it a link is waiting. A window
    /// still on the loading view takes it once the app has loaded.
    pub fn deliver(app: &AppHandle, urls: Vec<String>) {
        if !app.state::<DeepLinks>().hold(urls) {
            return;
        }
        if let Some(window) = WindowManager::focused(app) {
            window.unminimize().log_on_error("unminimizing for a link");
            window.show().log_on_error("showing the window for a link");
            window.set_focus().log_on_error("focusing the window for a link");
            ShellEvent::OpenLink.emit_to(&window);
        }
    }
}

/// The window takes the waiting `igni://` link, if any.
#[tauri::command]
pub(crate) fn igni_take_open_link(app: AppHandle) -> Option<String> {
    app.state::<DeepLinks>().take()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The web client's table, so the shell and the window agree on
    /// every link in it.
    fn cases() -> serde_json::Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../web/src/chat/deepLinks.cases.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        serde_json::from_str(&text).expect("deepLinks.cases.json is JSON")
    }

    #[test]
    fn the_shell_takes_the_links_the_table_says_it_takes() {
        let table = cases();
        for case in table["cases"].as_array().expect("cases[]") {
            let url = case["url"].as_str().unwrap();
            let shell = case["shell"].as_bool().unwrap();
            assert_eq!(DeepLinks::accepts(url), shell, "{url}");
        }
    }

    #[test]
    fn a_link_longer_than_any_address_igni_writes_is_refused() {
        let table = cases();
        let long = &table["tooLong"];
        let prefix = long["prefix"].as_str().unwrap();
        let fill = long["fill"].as_str().unwrap();
        let length = long["length"].as_u64().unwrap() as usize;
        assert!(!DeepLinks::accepts(&format!("{prefix}{}", fill.repeat(length))));
        assert!(DeepLinks::accepts(&format!("{prefix}{}", fill.repeat(10))));
    }

    #[test]
    fn the_last_link_is_held_and_given_out_once() {
        let links = DeepLinks::default();
        assert!(links.hold(vec![
            "igni://open?open=a".to_string(),
            "https://elsewhere".to_string(),
            "igni://open?open=b".to_string(),
        ]));
        assert_eq!(links.take().as_deref(), Some("igni://open?open=b"));
        assert_eq!(links.take(), None);
    }

    #[test]
    fn nothing_is_held_for_links_that_are_not_igni_s() {
        let links = DeepLinks::default();
        assert!(!links.hold(vec!["https://igni.example/?open=a".to_string()]));
        assert_eq!(links.take(), None);
    }

    #[test]
    fn a_link_argument_is_not_a_project_folder() {
        assert!(DeepLinks::is_link_arg("igni://open?open=a"));
        assert!(DeepLinks::is_link_arg("IGNI://open"));
        assert!(!DeepLinks::is_link_arg("/Users/me/igni"));
        assert!(!DeepLinks::is_link_arg("igni"));
        assert!(!DeepLinks::is_link_arg("ig"));
        assert!(!DeepLinks::is_link_arg("igni:"));
        assert!(!DeepLinks::is_link_arg("ignï/folder"));
    }
}
