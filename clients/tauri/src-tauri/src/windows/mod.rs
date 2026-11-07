//! App windows: building them, finding the focused one, opening more.

pub(crate) mod fullscreen;
mod label;
mod new_window;
mod pick;
pub(crate) mod title;

use std::sync::Arc;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, TitleBarStyle};

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

/// Managed in `setup`. Owns the folder-pick slot New Window claims.
#[derive(Clone, Default)]
pub(crate) struct WindowManager {
    pick: Arc<PickSlot>,
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

    /// The window a menu action belongs to, falling back to `main` when
    /// nothing reports focus (the macOS menu bar can hold it).
    pub fn focused(app: &AppHandle) -> Option<WebviewWindow> {
        app.webview_windows()
            .into_values()
            .find(|w| w.is_focused().unwrap_or(false))
            .or_else(|| app.get_webview_window(WindowLabel::MAIN))
    }

    /// Point `window` at `route`.
    pub fn navigate(window: &WebviewWindow, route: &str) {
        let target = serde_json::Value::from(route);
        window
            .eval(format!("location.href = {target}"))
            .log_on_error("navigating the window");
    }
}
