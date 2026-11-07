//! Bringing the first window from the loading view to the chat UI.

use tauri::{AppHandle, Manager};

use crate::backend::BackendSupervisor;
use crate::error::{LogOnError, ShellError};
use crate::events::ShellEvent;
use crate::launch_args::LaunchArgs;
use crate::runtime;
use crate::windows::{WindowLabel, WindowManager, WindowTitle};

/// The loading view the reinstall path walks the main window back to.
const REINSTALL_ROUTE: &str = "loading.html?msg=Reinstalling…";

pub(crate) struct Bootstrap<'a> {
    app: &'a AppHandle,
    launch: &'a LaunchArgs,
}

impl<'a> Bootstrap<'a> {
    pub fn new(app: &'a AppHandle, launch: &'a LaunchArgs) -> Self {
        Bootstrap { app, launch }
    }

    /// Connect to a backend, reporting progress to the loading view, then
    /// navigate the main window to the chat UI.
    pub fn run(&self) -> Result<(), ShellError> {
        if self.launch.reinstall() {
            runtime::reset_cache().log_on_error("--reinstall cache reset");
        }
        let app = self.app.clone();
        let progress = move |msg: &str| {
            if let Some(main) = app.get_webview_window(WindowLabel::MAIN) {
                ShellEvent::BootstrapProgress(msg.to_string()).emit_to(&main);
            }
        };
        let conn = self
            .app
            .state::<BackendSupervisor>()
            .connect(self.launch.project_dir(), &progress)?;

        if let Some(main) = self.app.get_webview_window(WindowLabel::MAIN) {
            // The FE replaces this on its first status update; it covers a
            // backend that never connects.
            main.set_title(&WindowTitle::for_dir(self.launch.project_dir()))
                .log_on_error("setting the main window title");
            WindowManager::navigate(&main, &conn.app_url(None));
        }
        Ok(())
    }

    /// Run on a background thread so the loading window stays responsive.
    /// A failure is shown by `loading.html`'s own error handler.
    pub fn spawn_in_background(app: &AppHandle, launch: LaunchArgs) {
        let app = app.clone();
        std::thread::spawn(move || {
            if let Err(e) = Bootstrap::new(&app, &launch).run() {
                let message = e.to_string();
                if let Some(main) = app.get_webview_window(WindowLabel::MAIN) {
                    ShellEvent::BootstrapError(message.clone()).emit_to(&main);
                }
                eprintln!("igni bootstrap failed: {message}");
            }
        });
    }
}

/// Wipe the managed runtime and bootstrap again. Wired to File ›
/// Reinstall Backend (Clean).
#[tauri::command]
pub(crate) fn reinstall_backend(app: AppHandle) -> Result<(), ShellError> {
    app.state::<BackendSupervisor>().release_for_reinstall()?;
    runtime::reset_cache()?;
    if let Some(main) = app.get_webview_window(WindowLabel::MAIN) {
        WindowManager::navigate(&main, REINSTALL_ROUTE);
    }
    let launch = app.state::<LaunchArgs>().inner().clone();
    Bootstrap::spawn_in_background(&app, launch);
    Ok(())
}
