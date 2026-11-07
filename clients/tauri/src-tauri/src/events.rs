//! Every event the shell pushes to a webview.
//!
//! The payloads stay a bare string or bool: `loading.html`, the
//! `igni-menu` bridge in `init_script.js` and `theme.css`'s
//! `data-fullscreen` mirror read them as such.

use tauri::{Emitter, Runtime, WebviewWindow};

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
}

impl ShellEvent {
    /// The event name the web side listens for.
    pub fn name(&self) -> &'static str {
        match self {
            ShellEvent::BootstrapProgress(_) => "igni-bootstrap-progress",
            ShellEvent::BootstrapError(_) => "igni-bootstrap-error",
            ShellEvent::Menu(_) => "igni-menu",
            ShellEvent::Fullscreen(_) => "igni-fullscreen",
        }
    }

    /// Emit through `window`, logging a failure rather than dropping it.
    pub fn emit_to<R: Runtime>(&self, window: &WebviewWindow<R>) {
        let result = match self {
            ShellEvent::BootstrapProgress(text)
            | ShellEvent::BootstrapError(text)
            | ShellEvent::Menu(text) => window.emit(self.name(), text),
            ShellEvent::Fullscreen(on) => window.emit(self.name(), on),
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
    }
}
