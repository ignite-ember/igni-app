//! The controller's [`ShellPort`] in the running app: Tauri's windows,
//! events and menu, and the backend supervisor.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use super::controller::ShellPort;
use super::state::Side;
use super::switchboard::{BackendSnapshot, WindowTarget};
use crate::backend::{BackendConn, BackendSupervisor};
use crate::events::broadcast_backend_state;
use crate::launch_args::LaunchArgs;
use crate::menu::MenuAction;
use crate::windows::{WindowLabel, WindowManager};

pub(crate) struct TauriShell {
    app: AppHandle,
    /// Each window's own folder (New Window's `dir`), kept while it is on
    /// the cloud, which has no folders, so it comes back to it.
    folders: Mutex<HashMap<String, String>>,
}

impl TauriShell {
    pub fn new(app: AppHandle) -> Self {
        TauriShell { app, folders: Mutex::new(HashMap::new()) }
    }

    fn folders(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.folders.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn supervisor(&self) -> tauri::State<'_, BackendSupervisor> {
        self.app.state::<BackendSupervisor>()
    }
}

/// The `dir` a window's URL carries.
fn folder_of(url: &tauri::Url) -> Option<String> {
    url.query_pairs().find(|(k, _)| k == "dir").map(|(_, v)| v.into_owned())
}

impl ShellPort for TauriShell {
    fn broadcast(&self, snapshot: &BackendSnapshot) {
        broadcast_backend_state(&self.app, snapshot);
    }

    fn point_windows(&self, target: WindowTarget, cloud_url: &str) {
        let conn = self.supervisor().current_conn();
        for (label, window) in self.app.webview_windows() {
            let current = window.url().ok();
            let route = match target {
                WindowTarget::Relay => {
                    if let Some(dir) = current.as_ref().and_then(folder_of) {
                        self.folders().insert(label.clone(), dir);
                    }
                    cloud_url.to_string()
                }
                WindowTarget::Local | WindowTarget::SignIn => {
                    let Some(conn) = conn.as_ref() else { continue };
                    let dir = if label == WindowLabel::MAIN {
                        None
                    } else {
                        current.as_ref().and_then(folder_of).or_else(|| self.folders().remove(&label))
                    };
                    conn.app_url(dir.as_deref())
                }
            };
            WindowManager::navigate(&window, &route);
        }
    }

    fn spawn_full_backend(&self) -> Result<(), String> {
        let supervisor = self.supervisor();
        supervisor.release_for_mode_change();
        let launch = self.app.state::<LaunchArgs>().inner().clone();
        supervisor.connect(launch.project_dir(), &|_| {}).map(|_| ()).map_err(|e| e.to_string())
    }

    fn use_account_only_backend(&self) -> Result<(), String> {
        let supervisor = self.supervisor();
        supervisor.release_for_mode_change();
        supervisor.connect_account_only(&|_| {}).map(|_| ()).map_err(|e| e.to_string())
    }

    fn label_menu(&self, side: Side) {
        let app = self.app.clone();
        let _ = self.app.run_on_main_thread(move || MenuAction::relabel_for_side(&app, side == Side::Cloud));
    }

    fn local_conn(&self) -> Option<BackendConn> {
        self.supervisor().current_conn()
    }

    fn focused(&self) -> bool {
        self.app.webview_windows().values().any(|w| w.is_focused().unwrap_or(false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_s_folder_is_read_from_its_url() {
        let url = tauri::Url::parse("tauri://localhost/index.html?ws=x&dir=%2FUsers%2Fme%2Fp%20q").unwrap();
        assert_eq!(folder_of(&url).as_deref(), Some("/Users/me/p q"));
        assert_eq!(folder_of(&tauri::Url::parse("tauri://localhost/index.html?ws=x").unwrap()), None);
    }
}
