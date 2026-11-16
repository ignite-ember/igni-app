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
    pub fn target(label: &str) -> EventTarget {
        EventTarget::WebviewWindow {
            label: label.to_owned(),
        }
    }

    /// Emit to `window` only, logging a failure rather than dropping it.
    pub fn emit_to<R: Runtime>(&self, window: &WebviewWindow<R>) {
        let target = Self::target(window.label());
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
    }

    #[test]
    fn an_event_is_for_its_own_window_only() {
        assert_eq!(
            ShellEvent::target("w-2"),
            EventTarget::WebviewWindow {
                label: "w-2".into()
            }
        );
    }
}
