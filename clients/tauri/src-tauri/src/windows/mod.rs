//! App windows: building them, finding the focused one, opening more.

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod browser_args;
mod focus;
pub(crate) mod fullscreen;
mod label;
mod new_window;
mod pick;
pub(crate) mod title;

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, TitleBarStyle};

use focus::FocusTracker;
#[cfg(target_os = "macos")]
use fullscreen::FullscreenWatcher;
pub(crate) use label::WindowLabel;
use pick::PickSlot;
pub(crate) use title::WindowTitle;

use crate::error::LogOnError;
use crate::init_script::InitScript;
#[cfg(target_os = "macos")]
use crate::macos::TrafficLights;

const WINDOW_WIDTH: f64 = 1100.0;
const WINDOW_HEIGHT: f64 = 780.0;

/// What to open: which window, at which page, titled how.
pub(crate) struct WindowSpec {
    pub label: WindowLabel,
    pub route: String,
    pub title: String,
}

/// Managed in `setup`. Owns the folder-pick slot New Window claims and
/// the record of which window last had focus.
#[derive(Clone, Default)]
pub(crate) struct WindowManager {
    pick: Arc<PickSlot>,
    focus: Arc<Mutex<FocusTracker>>,
}

impl WindowManager {
    /// Build one app window with the same chrome as every other: the init
    /// script (host bridges, external-link routing, menu events) and, on
    /// macOS, the overlay title bar with pinned traffic lights and the
    /// fullscreen watcher.
    pub fn build(&self, app: &AppHandle, spec: WindowSpec) -> tauri::Result<WebviewWindow> {
        let builder =
            WebviewWindowBuilder::new(app, spec.label.as_str(), WebviewUrl::App(spec.route.into()))
                .title(&spec.title)
                .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT);

        // The webview runs to the top edge; the FE's `.app-header` draws
        // the title row beside the traffic lights.
        #[cfg(target_os = "macos")]
        let builder = builder
            .title_bar_style(TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(LogicalPosition::new(
                TrafficLights::DEFAULT.x,
                TrafficLights::DEFAULT.y,
            ));

        // WebView2's switches: wry's defaults plus the environment's
        // (`browser_args.rs` says why the environment was being ignored).
        #[cfg(target_os = "windows")]
        let builder = builder.additional_browser_args(&browser_args::browser_args(
            std::env::var(browser_args::ENV).ok().as_deref(),
        ));

        let window = builder
            .initialization_script(InitScript::for_platform())
            .build()?;

        #[cfg(target_os = "macos")]
        {
            TrafficLights::DEFAULT.install_observer(window.clone());
            // The observer runs only when the runloop idles; pin now so a
            // slow first paint does not show AppKit's default position.
            TrafficLights::DEFAULT.reposition(&window);
            FullscreenWatcher::install(&window);
        }

        Ok(window)
    }

    /// The window a menu action belongs to: the one that reports focus,
    /// else the one that last gained it, else `main` (the macOS menu bar
    /// can hold focus itself).
    ///
    /// On Windows a window whose page has focus reports itself unfocused
    /// (the focus is in WebView2's own window), so asking alone sent New
    /// Chat from a second window's menu to the first (R624, desktop proof
    /// run 44887418816). Tauri still emits `Focused(true)` when the page
    /// gains focus, which [`WindowManager::note_focus`] records.
    pub fn focused(app: &AppHandle) -> Option<WebviewWindow> {
        let windows = app.webview_windows();
        let states: Vec<(String, bool)> = windows
            .iter()
            .map(|(label, w)| (label.clone(), w.is_focused().unwrap_or(false)))
            .collect();
        let last = app.try_state::<WindowManager>().and_then(|m| {
            m.focus
                .lock()
                .ok()
                .and_then(|f| f.last().map(str::to_string))
        });
        FocusTracker::pick(&states, last.as_deref())
            .and_then(|label| windows.get(&label).cloned())
            .or_else(|| app.get_webview_window(WindowLabel::MAIN))
    }

    /// Record a window's focus change (`WindowEvent::Focused`).
    pub fn note_focus(app: &AppHandle, label: &str, focused: bool) {
        if let Some(manager) = app.try_state::<WindowManager>() {
            if let Ok(mut tracker) = manager.focus.lock() {
                tracker.note(label, focused);
            }
        }
    }

    /// Forget a window that closed.
    pub fn forget(app: &AppHandle, label: &str) {
        if let Some(manager) = app.try_state::<WindowManager>() {
            if let Ok(mut tracker) = manager.focus.lock() {
                tracker.forget(label);
            }
        }
    }

    /// Point `window` at `route`.
    pub fn navigate(window: &WebviewWindow, route: &str) {
        let target = serde_json::Value::from(route);
        window
            .eval(format!("location.href = {target}"))
            .log_on_error("navigating the window");
    }
}
