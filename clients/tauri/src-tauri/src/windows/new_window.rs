//! File › New Window: pick a folder, then open a window bound to it.

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::backend::BackendSupervisor;
use crate::error::LogOnError;
use crate::windows::{WindowLabel, WindowManager, WindowSpec, WindowTitle};

impl WindowManager {
    /// Pick first, build second, so a cancelled picker leaves no empty
    /// window. The new window shares this app's backend and binds a
    /// session in the chosen folder through the URL's `dir` param.
    ///
    /// The pick blocks, so it runs on a worker; the build hops back to the
    /// main thread, where the label is chosen.
    pub fn open_new_window(&self, app: &AppHandle) {
        // A picker already up is modal and visible; a second one is what
        // breaks the window.
        let Some(claim) = self.pick.try_claim() else {
            return;
        };
        let manager = self.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            // Held until the build is queued, so two windows cannot race
            // onto one label.
            let _claim = claim;
            let Some(conn) = app
                .try_state::<BackendSupervisor>()
                .and_then(|s| s.current_conn())
            else {
                app.dialog()
                    .message("igni is still starting. Try again once the first window has loaded.")
                    .blocking_show();
                return;
            };
            let Some(folder) = app.dialog().file().blocking_pick_folder() else {
                return;
            };
            let Ok(path) = folder.into_path() else {
                return;
            };
            let route = conn.app_url(Some(&path.to_string_lossy()));
            let title = WindowTitle::of_path(&path);
            let builder_app = app.clone();
            app.run_on_main_thread(move || {
                let existing: Vec<String> = builder_app.webview_windows().into_keys().collect();
                let spec = WindowSpec {
                    label: WindowLabel::next_free(&existing),
                    route,
                    title,
                };
                manager
                    .build(&builder_app, spec)
                    .log_on_error("opening a new window");
            })
            .log_on_error("queueing the new window");
        });
    }
}
