//! The native menu bar and what its custom items do.
//!
//! Standard items come from `PredefinedMenuItem`, which brings the right
//! shortcut and localisation per platform. Custom items are either handled
//! here or forwarded to the focused window as [`ShellEvent::Menu`], which
//! `init_script.js` turns into the web UI's `igni-host` event.

use tauri::menu::{
    AboutMetadata, IsMenuItem, Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Manager, Wry};

use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::bootstrap;
use crate::diagnostics::BackendDiagnostics;
use crate::error::{LogOnError, ShellError};
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
    /// Linux and Windows: the predefined Quit is macOS-only there.
    Quit,
    /// Linux and Windows: the predefined fullscreen item is macOS-only.
    ToggleFullscreen,
    /// Linux: GTK has no predefined Close Window, Minimize or Maximize, and
    /// muda draws them disabled.
    CloseWindow,
    Minimize,
    Maximize,
}

impl MenuAction {
    const ALL: [MenuAction; 12] = [
        MenuAction::CheckUpdate,
        MenuAction::NewChat,
        MenuAction::NewWindow,
        MenuAction::RestartBackend,
        MenuAction::ReinstallBackend,
        MenuAction::DiagnoseBackend,
        MenuAction::ToggleDevtools,
        MenuAction::Quit,
        MenuAction::ToggleFullscreen,
        MenuAction::CloseWindow,
        MenuAction::Minimize,
        MenuAction::Maximize,
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
            MenuAction::Quit => "quit_app",
            MenuAction::ToggleFullscreen => "toggle_fullscreen",
            MenuAction::CloseWindow => "close_window",
            MenuAction::Minimize => "minimize_window",
            MenuAction::Maximize => "maximize_window",
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
            MenuAction::Quit => "Quit igni",
            MenuAction::ToggleFullscreen => "Toggle Full Screen",
            MenuAction::CloseWindow => "Close Window",
            MenuAction::Minimize => "Minimize",
            MenuAction::Maximize => "Maximize",
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
            MenuAction::Quit => Some("CmdOrCtrl+Q"),
            MenuAction::ToggleFullscreen => Some("F11"),
            MenuAction::CloseWindow => Some("CmdOrCtrl+W"),
            MenuAction::Minimize | MenuAction::Maximize => None,
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
                let outcome = bootstrap::reinstall_backend(app.clone());
                if let Some(text) = Self::refusal(&outcome) {
                    Self::tell(app, "igni · Reinstall Backend", text);
                }
                outcome.log_on_error("reinstall_backend");
            }
            MenuAction::RestartBackend => {
                let outcome = bootstrap::restart_backend(app.clone());
                if let Some(text) = Self::refusal(&outcome) {
                    Self::tell(app, "igni · Restart Backend", text);
                }
                outcome.log_on_error("restart_backend");
            }
            MenuAction::DiagnoseBackend => BackendDiagnostics::show(app),
            MenuAction::Quit => app.exit(0),
            MenuAction::ToggleFullscreen => {
                if let Some(window) = WindowManager::focused(app) {
                    let on = window.is_fullscreen().unwrap_or(false);
                    window
                        .set_fullscreen(!on)
                        .log_on_error("toggling fullscreen");
                }
            }
            MenuAction::CloseWindow => {
                if let Some(window) = WindowManager::focused(app) {
                    window.close().log_on_error("closing the window");
                }
            }
            MenuAction::Minimize => {
                if let Some(window) = WindowManager::focused(app) {
                    window.minimize().log_on_error("minimizing the window");
                }
            }
            MenuAction::Maximize => {
                if let Some(window) = WindowManager::focused(app) {
                    let result = if window.is_maximized().unwrap_or(false) {
                        window.unmaximize()
                    } else {
                        window.maximize()
                    };
                    result.log_on_error("maximizing the window");
                }
            }
            MenuAction::CheckUpdate | MenuAction::NewChat => {
                Self::forward(app, self.as_id());
            }
        }
    }

    /// What to tell the person when a menu action they asked for was
    /// refused. A refusal sent only to the log looked like a click that
    /// did nothing (R618).
    fn refusal(outcome: &Result<(), ShellError>) -> Option<String> {
        outcome.as_ref().err().map(ToString::to_string)
    }

    /// A native message box, off the main thread's event handler.
    fn tell(app: &AppHandle, title: &str, text: String) {
        app.dialog()
            .message(text)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::Ok)
            .show(|_| {});
    }

    /// Send a menu id to the focused window's web UI.
    pub fn forward(app: &AppHandle, id: &str) {
        if let Some(window) = WindowManager::focused(app) {
            ShellEvent::Menu(id.to_string()).emit_to(&window);
        }
    }

    /// Devtools exist only in debug builds.
    #[cfg_attr(not(debug_assertions), allow(unused_variables))]
    fn toggle_devtools(app: &AppHandle) {
        #[cfg(debug_assertions)]
        if let Some(window) = WindowManager::focused(app) {
            if window.is_devtools_open() {
                window.close_devtools();
            } else {
                window.open_devtools();
            }
        }
    }
}

/// One entry of the igni menu or the View menu, before it is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Slot {
    About,
    Action(MenuAction),
    Separator,
    /// macOS's own: Services, Hide, Hide Others, Show All, Quit, and its
    /// native fullscreen. On Linux muda draws them disabled (R624).
    Services,
    Hide,
    HideOthers,
    ShowAll,
    NativeQuit,
    NativeFullscreen,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    NativeMinimize,
    NativeMaximize,
    NativeCloseWindow,
}

/// What the menus hold on a platform. `macos`, `gtk` and `debug` are
/// passed in, not read from `cfg!`, so each combination can be tested
/// anywhere.
struct MenuLayout {
    macos: bool,
    /// Linux: muda's GTK backend has no Undo, Redo, Minimize, Maximize or
    /// Close Window, and draws each one disabled.
    gtk: bool,
    debug: bool,
}

impl MenuLayout {
    const fn current() -> Self {
        Self {
            macos: cfg!(target_os = "macos"),
            gtk: cfg!(target_os = "linux"),
            debug: cfg!(debug_assertions),
        }
    }

    /// Close Window, through the shell where GTK has none.
    fn close_window(&self) -> Slot {
        if self.gtk {
            Slot::Action(MenuAction::CloseWindow)
        } else {
            Slot::NativeCloseWindow
        }
    }

    fn file_menu(&self) -> Vec<Slot> {
        vec![
            Slot::Action(MenuAction::NewChat),
            Slot::Action(MenuAction::NewWindow),
            Slot::Separator,
            Slot::Action(MenuAction::RestartBackend),
            Slot::Action(MenuAction::ReinstallBackend),
            Slot::Action(MenuAction::DiagnoseBackend),
            Slot::Separator,
            self.close_window(),
        ]
    }

    /// The webview undoes and redoes typing itself (Ctrl+Z, Ctrl+Shift+Z);
    /// on GTK the menu items for it would only ever be disabled.
    fn edit_menu(&self) -> Vec<Slot> {
        let mut slots = Vec::new();
        if !self.gtk {
            slots.extend([Slot::Undo, Slot::Redo, Slot::Separator]);
        }
        slots.extend([Slot::Cut, Slot::Copy, Slot::Paste, Slot::SelectAll]);
        slots
    }

    fn window_menu(&self) -> Vec<Slot> {
        let (minimize, maximize) = if self.gtk {
            (
                Slot::Action(MenuAction::Minimize),
                Slot::Action(MenuAction::Maximize),
            )
        } else {
            (Slot::NativeMinimize, Slot::NativeMaximize)
        };
        vec![minimize, maximize, Slot::Separator, self.close_window()]
    }

    fn app_menu(&self) -> Vec<Slot> {
        let mut slots = vec![
            Slot::About,
            Slot::Action(MenuAction::CheckUpdate),
            Slot::Separator,
        ];
        if self.macos {
            slots.extend([
                Slot::Services,
                Slot::Separator,
                Slot::Hide,
                Slot::HideOthers,
                Slot::ShowAll,
                Slot::Separator,
                Slot::NativeQuit,
            ]);
        } else {
            slots.push(Slot::Action(MenuAction::Quit));
        }
        slots
    }

    /// Developer tools exist only in debug builds, so a release build
    /// does not offer an item that does nothing (R624).
    fn view_menu(&self) -> Vec<Slot> {
        let mut slots = vec![if self.macos {
            Slot::NativeFullscreen
        } else {
            Slot::Action(MenuAction::ToggleFullscreen)
        }];
        if self.debug {
            slots.push(Slot::Action(MenuAction::ToggleDevtools));
        }
        slots
    }
}

pub(crate) struct AppMenu;

impl AppMenu {
    fn built(app: &AppHandle, slots: Vec<Slot>) -> tauri::Result<Vec<Box<dyn IsMenuItem<Wry>>>> {
        let about = || AboutMetadata {
            name: Some("igni".into()),
            copyright: Some("© 2026 Ignite Ember".into()),
            website: Some("https://igni.sh".into()),
            ..Default::default()
        };
        slots
            .into_iter()
            .map(|slot| -> tauri::Result<Box<dyn IsMenuItem<Wry>>> {
                Ok(match slot {
                    Slot::About => Box::new(PredefinedMenuItem::about(
                        app,
                        Some("About igni"),
                        Some(about()),
                    )?),
                    Slot::Action(action) => Box::new(action.item(app)?),
                    Slot::Separator => Box::new(PredefinedMenuItem::separator(app)?),
                    Slot::Services => Box::new(PredefinedMenuItem::services(app, None)?),
                    Slot::Hide => Box::new(PredefinedMenuItem::hide(app, None)?),
                    Slot::HideOthers => Box::new(PredefinedMenuItem::hide_others(app, None)?),
                    Slot::ShowAll => Box::new(PredefinedMenuItem::show_all(app, None)?),
                    Slot::NativeQuit => Box::new(PredefinedMenuItem::quit(app, None)?),
                    Slot::NativeFullscreen => Box::new(PredefinedMenuItem::fullscreen(app, None)?),
                    Slot::Undo => Box::new(PredefinedMenuItem::undo(app, None)?),
                    Slot::Redo => Box::new(PredefinedMenuItem::redo(app, None)?),
                    Slot::Cut => Box::new(PredefinedMenuItem::cut(app, None)?),
                    Slot::Copy => Box::new(PredefinedMenuItem::copy(app, None)?),
                    Slot::Paste => Box::new(PredefinedMenuItem::paste(app, None)?),
                    Slot::SelectAll => Box::new(PredefinedMenuItem::select_all(app, None)?),
                    Slot::NativeMinimize => Box::new(PredefinedMenuItem::minimize(app, None)?),
                    Slot::NativeMaximize => Box::new(PredefinedMenuItem::maximize(app, None)?),
                    Slot::NativeCloseWindow => {
                        Box::new(PredefinedMenuItem::close_window(app, None)?)
                    }
                })
            })
            .collect()
    }

    fn submenu(app: &AppHandle, title: &str, slots: Vec<Slot>) -> tauri::Result<Submenu<Wry>> {
        let items = Self::built(app, slots)?;
        let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|b| b.as_ref()).collect();
        Submenu::with_items(app, title, true, &refs)
    }

    /// Set before the first window builds, or macOS shows Tauri's stub.
    pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
        // On Linux and Windows the app menu folds into the window's.
        let layout = MenuLayout::current();
        let app_menu = Self::submenu(app, "igni", layout.app_menu())?;
        let file_menu = Self::submenu(app, "File", layout.file_menu())?;
        let edit_menu = Self::submenu(app, "Edit", layout.edit_menu())?;
        let view_menu = Self::submenu(app, "View", layout.view_menu())?;
        let window_menu = Self::submenu(app, "Window", layout.window_menu())?;
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
    fn a_refused_reinstall_is_told_in_the_error_s_own_words() {
        assert_eq!(MenuAction::refusal(&Ok(())), None);
        assert_eq!(
            MenuAction::refusal(&Err(ShellError::AttachedNotOwned)).as_deref(),
            Some(ShellError::AttachedNotOwned.to_string().as_str())
        );
    }

    #[test]
    fn a_release_build_offers_no_developer_tools() {
        for macos in [true, false] {
            let release = MenuLayout {
                macos,
                gtk: false,
                debug: false,
            };
            assert!(!release
                .view_menu()
                .contains(&Slot::Action(MenuAction::ToggleDevtools)));
            let debug = MenuLayout {
                macos,
                gtk: false,
                debug: true,
            };
            assert!(debug
                .view_menu()
                .contains(&Slot::Action(MenuAction::ToggleDevtools)));
        }
    }

    #[test]
    fn linux_and_windows_get_a_quit_and_fullscreen_that_work() {
        let other = MenuLayout {
            macos: false,
            gtk: true,
            debug: false,
        };
        let app_menu = other.app_menu();
        for mac_only in [
            Slot::Services,
            Slot::Hide,
            Slot::HideOthers,
            Slot::ShowAll,
            Slot::NativeQuit,
        ] {
            assert!(
                !app_menu.contains(&mac_only),
                "{mac_only:?} is drawn disabled off macOS"
            );
        }
        assert!(app_menu.contains(&Slot::Action(MenuAction::Quit)));
        assert_eq!(
            other.view_menu(),
            vec![Slot::Action(MenuAction::ToggleFullscreen)]
        );
    }

    #[test]
    fn macos_keeps_its_own_app_menu() {
        let mac = MenuLayout {
            macos: true,
            gtk: false,
            debug: false,
        };
        assert!(mac.app_menu().contains(&Slot::NativeQuit));
        assert!(mac.app_menu().contains(&Slot::Services));
        assert!(!mac.app_menu().contains(&Slot::Action(MenuAction::Quit)));
        assert_eq!(mac.view_menu(), vec![Slot::NativeFullscreen]);
    }

    /// Every item GTK cannot draw enabled, by the slot that would hold it.
    const GTK_DISABLED: [Slot; 5] = [
        Slot::Undo,
        Slot::Redo,
        Slot::NativeMinimize,
        Slot::NativeMaximize,
        Slot::NativeCloseWindow,
    ];

    // R624: on Linux, File > Close Window, Edit > Undo/Redo and the whole
    // Window menu were drawn disabled (the desktop proof read them so
    // through AT-SPI, run 44788577615).
    #[test]
    fn linux_menus_hold_nothing_gtk_draws_disabled() {
        let linux = MenuLayout {
            macos: false,
            gtk: true,
            debug: false,
        };
        let all: Vec<Slot> = [
            linux.app_menu(),
            linux.file_menu(),
            linux.edit_menu(),
            linux.view_menu(),
            linux.window_menu(),
        ]
        .concat();
        for dead in GTK_DISABLED {
            assert!(!all.contains(&dead), "{dead:?} is drawn disabled on GTK");
        }
        assert!(linux
            .file_menu()
            .contains(&Slot::Action(MenuAction::CloseWindow)));
        assert_eq!(
            linux.window_menu(),
            vec![
                Slot::Action(MenuAction::Minimize),
                Slot::Action(MenuAction::Maximize),
                Slot::Separator,
                Slot::Action(MenuAction::CloseWindow),
            ]
        );
        assert_eq!(
            linux.edit_menu(),
            vec![Slot::Cut, Slot::Copy, Slot::Paste, Slot::SelectAll]
        );
    }

    #[test]
    fn macos_and_windows_keep_the_predefined_edit_and_window_items() {
        for macos in [true, false] {
            let layout = MenuLayout {
                macos,
                gtk: false,
                debug: false,
            };
            assert!(layout.edit_menu().starts_with(&[Slot::Undo, Slot::Redo]));
            assert!(layout.file_menu().contains(&Slot::NativeCloseWindow));
            assert!(layout.window_menu().contains(&Slot::NativeMinimize));
            assert!(!layout
                .window_menu()
                .contains(&Slot::Action(MenuAction::CloseWindow)));
        }
    }

    #[test]
    fn the_ids_the_web_ui_handles_are_unchanged() {
        assert_eq!(MenuAction::NewChat.as_id(), "new_chat");
        assert_eq!(MenuAction::CheckUpdate.as_id(), "check_update");
    }
}
