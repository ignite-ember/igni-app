//! igni desktop shell: finds or spawns the Python backend, then opens the
//! shared web UI (clients/web) pointed at its WebSocket. A backend this
//! app spawned is stopped on exit and also watches this process's PID.

mod backend;
mod bootstrap;
mod cloud;
mod deep_link;
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

use std::sync::Arc;

use tauri::{Manager, RunEvent};

use backend::BackendSupervisor;
use bootstrap::Bootstrap;
use cloud::controller::CloudController;
use cloud::gateway::GatewayUrl;
use cloud::shell::TauriShell;
use desktop_settings::CloudSettings;
use deep_link::DeepLinks;
use launch_args::LaunchArgs;
use menu::{AppMenu, MenuAction};
use windows::{WindowLabel, WindowManager, WindowSpec, WindowTitle};

pub fn run() {
    // First: on Windows and Linux a followed igni:// link starts a second
    // process; this hands its URL to the running app (the `deep-link`
    // feature routes it to `on_open_url` below) and ends the second one.
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = WindowManager::focused(app) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
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
            deep_link::igni_take_open_link,
            cloud::commands::backend_state,
            cloud::commands::switch_backend,
            cloud::commands::cloud_sign_in,
            cloud::commands::cloud_retry,
            cloud::commands::dismiss_backend_notice,
            cloud::commands::report_local_activity,
            cloud::commands::account_rpc,
            cloud::commands::cloud_page_origin,
            menu::igni_menu_shortcut,
        ])
        .setup(|app| {
            let handle = app.handle();
            app.set_menu(AppMenu::build(handle)?)?;

            let launch = LaunchArgs::from_process();
            app.manage(BackendSupervisor::default());
            app.manage(WindowManager::default());
            app.manage(launch.clone());
            app.manage(DeepLinks::default());
            // The cloud switch (`cloud/`): one app-wide side, owned here.
            {
                let home = dirs::home_dir().unwrap_or_default();
                let state_dir = app.path().app_config_dir().unwrap_or_else(|_| home.join(".igni/desktop"));
                app.manage(CloudController::new(
                    home,
                    state_dir,
                    CloudSettings::load(),
                    Arc::new(TauriShell::new(handle.clone())),
                    GatewayUrl::insecure_allowed_here(),
                ));
            }

            // igni:// links (`deep_link.rs`): the one the app was launched
            // with is held for the window to take once the app has
            // loaded; one followed later brings the window forward.
            {
                #[cfg(any(windows, target_os = "linux"))]
                use crate::error::LogOnError;
                use tauri_plugin_deep_link::DeepLinkExt;
                // An AppImage, or a build run from the tree, has no
                // installer to register the scheme.
                #[cfg(any(windows, target_os = "linux"))]
                handle
                    .deep_link()
                    .register_all()
                    .log_on_error("registering igni://");
                if let Ok(Some(urls)) = handle.deep_link().get_current() {
                    app.state::<DeepLinks>()
                        .hold(urls.into_iter().map(|u| u.to_string()));
                }
                let links = handle.clone();
                handle.deep_link().on_open_url(move |event| {
                    let urls = event.urls().into_iter().map(|u| u.to_string()).collect();
                    DeepLinks::deliver(&links, urls);
                });
            }

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
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(focused) => {
                WindowManager::note_focus(window.app_handle(), window.label(), *focused)
            }
            tauri::WindowEvent::Destroyed => {
                WindowManager::forget(window.app_handle(), window.label())
            }
            _ => {}
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
