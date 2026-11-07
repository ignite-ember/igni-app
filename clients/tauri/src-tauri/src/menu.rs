//! The native menu bar and what its custom items do.
//!
//! Standard items come from `PredefinedMenuItem`, which brings the right
//! shortcut and localisation per platform. Custom items are either handled
//! here or forwarded to the focused window as [`ShellEvent::Menu`], which
//! `init_script.js` turns into the web UI's `igni-host` event.

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};

use crate::bootstrap;
use crate::diagnostics::BackendDiagnostics;
use crate::error::LogOnError;
use crate::events::ShellEvent;
use crate::windows::WindowManager;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MenuAction {
    CheckUpdate,
    NewChat,
    NewWindow,
    RestartBackend,
    ReinstallBackend,
    DiagnoseBackend,
    ToggleDevtools,
}

impl MenuAction {
    const ALL: [MenuAction; 7] = [
        MenuAction::CheckUpdate,
        MenuAction::NewChat,
        MenuAction::NewWindow,
        MenuAction::RestartBackend,
        MenuAction::ReinstallBackend,
        MenuAction::DiagnoseBackend,
        MenuAction::ToggleDevtools,
    ];

    /// The menu item id, which is also the id the web UI receives.
    pub fn as_id(self) -> &'static str {
        match self {
            MenuAction::CheckUpdate => "check_update",
            MenuAction::NewChat => "new_chat",
            MenuAction::NewWindow => "new_window",
            MenuAction::RestartBackend => "restart_backend",
            MenuAction::ReinstallBackend => "reinstall_backend",
            MenuAction::DiagnoseBackend => "diagnose_backend",
            MenuAction::ToggleDevtools => "toggle_devtools",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.as_id() == id)
    }

    pub fn label(self) -> &'static str {
        match self {
            MenuAction::CheckUpdate => "Check for Updates…",
            MenuAction::NewChat => "New Chat",
            MenuAction::NewWindow => "New Window…",
            MenuAction::RestartBackend => "Restart Backend",
            MenuAction::ReinstallBackend => "Reinstall Backend (Clean)",
            MenuAction::DiagnoseBackend => "Diagnose Backend",
            MenuAction::ToggleDevtools => "Toggle Developer Tools",
        }
    }

    /// New Window takes Shift-Cmd-N because New Chat, the far more
    /// frequent action, owns Cmd-N (as in VS Code). Restart Backend has
    /// none: Shift-Cmd-R is the near-universal hard reload, and killing the
    /// backend by reflex is the worst way to debug a stuck stream.
    pub fn accelerator(self) -> Option<&'static str> {
        match self {
            MenuAction::NewChat => Some("CmdOrCtrl+N"),
            MenuAction::NewWindow => Some("CmdOrCtrl+Shift+N"),
            MenuAction::ToggleDevtools => Some("CmdOrCtrl+Alt+I"),
            MenuAction::CheckUpdate
            | MenuAction::RestartBackend
            | MenuAction::ReinstallBackend
            | MenuAction::DiagnoseBackend => None,
        }
    }

    fn item(self, app: &AppHandle) -> tauri::Result<MenuItem<Wry>> {
        MenuItem::with_id(app, self.as_id(), self.label(), true, self.accelerator())
    }

    /// Run the action: native ones here, the rest in the web UI.
    pub fn handle(self, app: &AppHandle) {
        match self {
            MenuAction::NewWindow => {
                if let Some(windows) = app.try_state::<WindowManager>() {
                    windows.open_new_window(app);
                }
            }
            MenuAction::ToggleDevtools => Self::toggle_devtools(app),
            MenuAction::ReinstallBackend => {
                bootstrap::reinstall_backend(app.clone()).log_on_error("reinstall_backend");
            }
            MenuAction::DiagnoseBackend => BackendDiagnostics::show(app),
            MenuAction::CheckUpdate | MenuAction::NewChat | MenuAction::RestartBackend => {
                Self::forward(app, self.as_id());
            }
        }
    }

    /// Send a menu id to the focused window's web UI.
    pub fn forward(app: &AppHandle, id: &str) {
        if let Some(window) = WindowManager::focused(app) {
            ShellEvent::Menu(id.to_string()).emit_to(&window);
        }
    }

    /// Devtools exist only in debug builds.
    fn toggle_devtools(app: &AppHandle) {
        #[cfg(debug_assertions)]
        if let Some(window) = WindowManager::focused(app) {
            if window.is_devtools_open() {
                window.close_devtools();
            } else {
                window.open_devtools();
            }
        }
        #[cfg(not(debug_assertions))]
        let _ = app;
    }
}

pub(crate) struct AppMenu;

impl AppMenu {
    /// Set before the first window builds, or macOS shows Tauri's stub.
    pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
        let separator = || PredefinedMenuItem::separator(app);

        // On Linux and Windows the app menu folds into the window's.
        let about = AboutMetadata {
            name: Some("igni".into()),
            copyright: Some("© 2026 Ignite Ember".into()),
            website: Some("https://ignite-ember.sh".into()),
            ..Default::default()
        };
        let app_menu = Submenu::with_items(
            app,
            "igni",
            true,
            &[
                &PredefinedMenuItem::about(app, Some("About igni"), Some(about))?,
                &MenuAction::CheckUpdate.item(app)?,
                &separator()?,
                &PredefinedMenuItem::services(app, None)?,
                &separator()?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &separator()?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        let file_menu = Submenu::with_items(
            app,
            "File",
            true,
            &[
                &MenuAction::NewChat.item(app)?,
                &MenuAction::NewWindow.item(app)?,
                &separator()?,
                &MenuAction::RestartBackend.item(app)?,
                &MenuAction::ReinstallBackend.item(app)?,
                &MenuAction::DiagnoseBackend.item(app)?,
                &separator()?,
                &PredefinedMenuItem::close_window(app, None)?,
            ],
        )?;
        let edit_menu = Submenu::with_items(
            app,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &separator()?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ],
        )?;
        let view_menu = Submenu::with_items(
            app,
            "View",
            true,
            &[
                &PredefinedMenuItem::fullscreen(app, None)?,
                &MenuAction::ToggleDevtools.item(app)?,
            ],
        )?;
        let window_menu = Submenu::with_items(
            app,
            "Window",
            true,
            &[
                &PredefinedMenuItem::minimize(app, None)?,
                &PredefinedMenuItem::maximize(app, None)?,
                &separator()?,
                &PredefinedMenuItem::close_window(app, None)?,
            ],
        )?;
        MenuBuilder::new(app)
            .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
            .build()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_id_dispatches_back_to_its_action() {
        for action in MenuAction::ALL {
            assert_eq!(MenuAction::from_id(action.as_id()), Some(action));
        }
    }

    #[test]
    fn an_unknown_id_is_not_an_action() {
        assert_eq!(MenuAction::from_id("quit"), None);
    }

    #[test]
    fn the_ids_the_web_ui_handles_are_unchanged() {
        assert_eq!(MenuAction::NewChat.as_id(), "new_chat");
        assert_eq!(MenuAction::RestartBackend.as_id(), "restart_backend");
        assert_eq!(MenuAction::CheckUpdate.as_id(), "check_update");
    }
}
