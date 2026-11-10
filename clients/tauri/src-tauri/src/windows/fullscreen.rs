//! Native fullscreen state, mirrored into `<html data-fullscreen>`.

#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::Arc;
use tauri::WebviewWindow;
#[cfg(target_os = "macos")]
use tauri::WindowEvent;

#[cfg(target_os = "macos")]
use crate::events::ShellEvent;

/// Pushes [`ShellEvent::Fullscreen`] on every change. Native fullscreen
/// moves the traffic lights into the slide-down panel, so the FE shrinks
/// the header gutter that made room for them.
#[cfg(target_os = "macos")]
pub(crate) struct FullscreenWatcher {
    last: AtomicBool,
}

#[cfg(target_os = "macos")]
impl FullscreenWatcher {
    pub fn install(window: &WebviewWindow) {
        let initial = window.is_fullscreen().unwrap_or(false);
        let watcher = Arc::new(FullscreenWatcher {
            last: AtomicBool::new(initial),
        });
        ShellEvent::Fullscreen(initial).emit_to(window);
        let watched = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::Resized(_) = event {
                watcher.observe(&watched);
            }
        });
    }

    fn observe(&self, window: &WebviewWindow) {
        let now = window.is_fullscreen().unwrap_or(false);
        if now != self.last.swap(now, Ordering::Relaxed) {
            ShellEvent::Fullscreen(now).emit_to(window);
        }
    }
}

/// The FE's fullscreen poll. `is_fullscreen` reads `NSWindow.styleMask`
/// directly, so this costs no more than the invoke.
#[tauri::command]
pub(crate) fn igni_is_fullscreen(window: WebviewWindow) -> bool {
    window.is_fullscreen().unwrap_or(false)
}
