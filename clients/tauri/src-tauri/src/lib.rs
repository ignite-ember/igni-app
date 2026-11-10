//! igni desktop shell: finds or spawns the Python backend, then opens the
//! shared web UI (clients/web) pointed at its WebSocket. A backend this
//! app spawned is stopped on exit and also watches this process's PID.

mod backend;
mod bootstrap;
mod desktop_settings;
mod diagnostics;
mod discovery;
mod error;
mod events;
mod group_pack;
mod init_script;
mod launch_args;
#[cfg(target_os = "macos")]
mod macos;
mod menu;
mod runtime;
mod update_policy;
mod updater;
mod windows;

use tauri::{Manager, RunEvent};

use backend::BackendSupervisor;
use bootstrap::Bootstrap;
use launch_args::LaunchArgs;
use menu::{AppMenu, MenuAction};
use windows::{WindowLabel, WindowManager, WindowSpec, WindowTitle};

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    // Lifts WKWebView's 60 Hz cap so ProMotion displays paint at 120 Hz.
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_macos_fps::init());

    builder
        .invoke_handler(tauri::generate_handler![
            windows::title::set_app_title,
            bootstrap::reinstall_backend,
            windows::fullscreen::igni_is_fullscreen,
            updater::igni_check_update,
            updater::igni_install_update,
        ])
        .setup(|app| {
            let handle = app.handle();
            app.set_menu(AppMenu::build(handle)?)?;

            let launch = LaunchArgs::from_process();
            app.manage(BackendSupervisor::default());
            app.manage(WindowManager::default());
            app.manage(launch.clone());

            // The loading view opens at once, so launch shows a window
            // rather than a bouncing dock icon while the runtime installs.
            app.state::<WindowManager>().build(
                handle,
                WindowSpec {
                    label: WindowLabel::main(),
                    route: "loading.html".to_string(),
                    title: WindowTitle::FALLBACK.to_string(),
                },
            )?;
            Bootstrap::spawn_in_background(handle, launch);
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match MenuAction::from_id(id) {
                Some(action) => action.handle(app),
                // Predefined items and anything else go to the web UI as is.
                None => MenuAction::forward(app, id),
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building igni app")
        .run(|app, event| {
            // Reached when the last window closes, on every platform.
            if let RunEvent::Exit = event {
                if let Some(supervisor) = app.try_state::<BackendSupervisor>() {
                    supervisor.shutdown_on_exit();
                }
            }
        });
}
