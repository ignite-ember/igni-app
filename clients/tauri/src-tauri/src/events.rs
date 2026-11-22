//! Every event the shell pushes to a webview.
//!
//! The payloads stay a bare string or bool: `loading.html`, the
//! `igni-menu` bridge in `init_script.js` and `theme.css`'s
//! `data-fullscreen` mirror read them as such.

use tauri::{Emitter, EventTarget, Runtime, WebviewWindow};

use crate::error::LogOnError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ShellEvent {
    /// A status line for the loading view during bootstrap.
    BootstrapProgress(String),
    /// Bootstrap failed; `loading.html` renders the message.
    BootstrapError(String),
    /// A menu item the web UI handles, by id.
    Menu(String),
    /// The window entered (`true`) or left native fullscreen. Only the
    /// macOS watcher sends it.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Fullscreen(bool),
    /// An `igni://` link is waiting; the window takes it with
    /// `igni_take_open_link` (see `deep_link.rs`).
    OpenLink,
}

impl ShellEvent {
    /// The event name the web side listens for.
    pub fn name(&self) -> &'static str {
        match self {
            ShellEvent::BootstrapProgress(_) => "igni-bootstrap-progress",
            ShellEvent::BootstrapError(_) => "igni-bootstrap-error",
            ShellEvent::Menu(_) => "igni-menu",
            ShellEvent::Fullscreen(_) => "igni-fullscreen",
            ShellEvent::OpenLink => "igni-open-link",
        }
    }

    /// Who hears an event meant for the window labelled `label`: that
    /// window alone. `Emitter::emit` broadcasts to every webview whatever
    /// handle it is called on, so one New Chat in the second window's
    /// menu cleared both windows, and one Check for Updates checked twice
    /// (R624). `init_script.js` listens on its own webview window to match.
    ///
    /// The *kind* is as much a part of the address as the label, and
    /// Tauri matches it exactly: an event addressed to
    /// `WebviewWindow { label }` reaches a listener that registered with
    /// that kind and with no other kind — a listener that registered as
    /// `Webview { label }` never hears it. The window's own listeners
    /// are registered from the page, and which kind they carry is the
    /// page's business (the JS API registers the window's kind, the Rust
    /// API the webview's). `AnyLabel { label }` is the address every
    /// listener carrying that label takes, whichever kind it registered
    /// with — and still no other window's.
    pub fn target(label: &str) -> EventTarget {
        EventTarget::AnyLabel {
            label: label.to_owned(),
        }
    }

    /// Emit to `window` only, logging a failure rather than dropping it.
    pub fn emit_to<R: Runtime>(&self, window: &WebviewWindow<R>) {
        let target = Self::target(window.label());
        if matches!(self, ShellEvent::OpenLink) {
            // The window's URL carries the session token, so it is not
            // printed: the label is what a reader needs to tell the
            // windows apart.
            eprintln!(
                "[igni] emitting {} to {:?} (the window is {:?})",
                self.name(),
                target,
                window.label()
            );
        }
        let result = match self {
            ShellEvent::BootstrapProgress(text)
            | ShellEvent::BootstrapError(text)
            | ShellEvent::Menu(text) => window.emit_to(target, self.name(), text),
            ShellEvent::Fullscreen(on) => window.emit_to(target, self.name(), on),
            ShellEvent::OpenLink => window.emit_to(target, self.name(), ()),
        };
        result.log_on_error(&format!("emitting {}", self.name()));
    }
}

/// The app-wide side and state of the cloud switch (§4.2). Unlike the
/// events above it goes to every window: the choice is the app's, and
/// every window renders it. `init_script.js` hands it to the web UI as an
/// `igni-host` event of type `igni:backend-state`.
pub(crate) const BACKEND_STATE_EVENT: &str = "igni-backend-state";

/// Send `snapshot` to every window.
pub(crate) fn broadcast_backend_state<R: Runtime, S: serde::Serialize + Clone>(app: &tauri::AppHandle<R>, snapshot: &S) {
    app.emit(BACKEND_STATE_EVENT, snapshot.clone())
        .log_on_error(&format!("emitting {BACKEND_STATE_EVENT}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wire_names_are_unchanged() {
        assert_eq!(
            ShellEvent::BootstrapProgress(String::new()).name(),
            "igni-bootstrap-progress"
        );
        assert_eq!(
            ShellEvent::BootstrapError(String::new()).name(),
            "igni-bootstrap-error"
        );
        assert_eq!(ShellEvent::Menu(String::new()).name(), "igni-menu");
        assert_eq!(ShellEvent::Fullscreen(false).name(), "igni-fullscreen");
        assert_eq!(ShellEvent::OpenLink.name(), "igni-open-link");
        assert_eq!(BACKEND_STATE_EVENT, "igni-backend-state");
    }

    #[test]
    fn an_event_is_for_its_own_window_only() {
        assert_eq!(
            ShellEvent::target("w-2"),
            EventTarget::AnyLabel {
                label: "w-2".into()
            }
        );
    }

    /// The window's own listeners hear the event, whichever kind they
    /// registered with. The page registers through the JS API (the
    /// window's kind) and the shell's own code registers through the
    /// Rust API (the webview's kind); Tauri matches a kind exactly, so
    /// an address of one kind reaches the other kind's listeners never.
    /// The address the shell uses reaches both.
    #[test]
    fn the_window_hears_the_shell_event() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        use tauri::Listener;

        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("the mock app");
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("the window");

        // The webview's kind: what the Rust API registers.
        let webview_kind = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&webview_kind);
        window.as_ref().listen("igni-open-link", move |_| {
            flag.store(true, Ordering::SeqCst)
        });
        // The window's kind: what the JS API registers.
        let window_kind = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&window_kind);
        window.listen("igni-open-link", move |_| {
            flag.store(true, Ordering::SeqCst)
        });

        ShellEvent::OpenLink.emit_to(&window);

        assert!(
            webview_kind.load(Ordering::SeqCst),
            "the window's webview heard nothing"
        );
        assert!(
            window_kind.load(Ordering::SeqCst),
            "the window heard nothing"
        );
    }

    /// The other window hears nothing: the event is for one window, and
    /// the second window's menu must not act on it.
    #[test]
    fn the_other_window_hears_nothing() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        use tauri::Listener;

        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("the mock app");
        let first = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("the first window");
        let second = tauri::WebviewWindowBuilder::new(&app, "w-2", Default::default())
            .build()
            .expect("the second window");

        let webview_kind = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&webview_kind);
        second.as_ref().listen("igni-open-link", move |_| {
            flag.store(true, Ordering::SeqCst)
        });
        let window_kind = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&window_kind);
        second.listen("igni-open-link", move |_| {
            flag.store(true, Ordering::SeqCst)
        });

        ShellEvent::OpenLink.emit_to(&first);

        assert!(
            !webview_kind.load(Ordering::SeqCst),
            "the second window's webview heard an event meant for the first"
        );
        assert!(
            !window_kind.load(Ordering::SeqCst),
            "the second window heard an event meant for the first"
        );
    }
}
