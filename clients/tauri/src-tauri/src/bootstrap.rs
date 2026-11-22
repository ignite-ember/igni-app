//! Bringing the first window from the loading view to the chat UI, and
//! bringing it back when the backend this app started dies on its own.

use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::backend::{BackendConn, BackendSupervisor, Liveness};
use crate::cloud::controller::CloudController;
use crate::cloud::switchboard::WindowTarget;
use crate::error::{LogOnError, ShellError};
use crate::events::ShellEvent;
use crate::launch_args::LaunchArgs;
use crate::runtime::ManagedRuntime;
use crate::windows::{WindowLabel, WindowManager, WindowTitle};

/// The loading view the reinstall path walks the main window back to.
const REINSTALL_ROUTE: &str = "loading.html?msg=Reinstalling…";
/// The loading view the main window shows while the backend restarts.
const RESTART_ROUTE: &str = "loading.html?msg=Restarting the backend…";
/// The loading view the main window shows while a backend that died on
/// its own is replaced.
const CRASH_ROUTE: &str = "loading.html?msg=The backend stopped unexpectedly. Starting it again…";
/// The loading view left up when backends keep dying.
const CRASH_GIVE_UP_ROUTE: &str =
    "loading.html?msg=The igni backend keeps stopping, so it was not started again. \
     Choose File > Restart Backend to try once more, or File > Diagnose Backend.";
/// How often a crash watcher looks at its backend.
const CRASH_POLL: Duration = Duration::from_millis(500);

/// What the loading view would have heard so far: the latest progress
/// line and, once it failed, the failure.
///
/// Events reach only a page that is already listening. An instant
/// failure — an air-gapped machine with no runtime refuses before
/// anything is downloaded — was emitted, and its message evaluated into
/// the window, before WebView2 had even loaded `loading.html`; the page
/// then came up on "Starting up…" and stayed there, with the reason lost.
/// Found by the Windows desktop E2E job (ENT-016). The page now asks for
/// this state when it attaches (`igni_bootstrap_state`) as well as
/// listening.
#[derive(Default)]
pub(crate) struct BootstrapState {
    inner: std::sync::Mutex<BootstrapSnapshot>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub(crate) struct BootstrapSnapshot {
    pub progress: Option<String>,
    pub error: Option<String>,
}

impl BootstrapState {
    fn update(&self, f: impl FnOnce(&mut BootstrapSnapshot)) {
        if let Ok(mut s) = self.inner.lock() {
            f(&mut s);
        }
    }

    pub fn started(&self) {
        self.update(|s| *s = BootstrapSnapshot::default());
    }

    pub fn progressed(&self, line: &str) {
        self.update(|s| s.progress = Some(line.to_string()));
    }

    pub fn failed(&self, message: &str) {
        self.update(|s| s.error = Some(message.to_string()));
    }

    pub fn snapshot(&self) -> BootstrapSnapshot {
        self.inner.lock().map(|s| s.clone()).unwrap_or_default()
    }
}

/// The loading view's catch-up: what it missed before it was listening.
#[tauri::command]
pub(crate) fn igni_bootstrap_state(app: AppHandle) -> BootstrapSnapshot {
    app.try_state::<BootstrapState>()
        .map(|s| s.snapshot())
        .unwrap_or_default()
}

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
            ManagedRuntime::locate()
                .and_then(|runtime| runtime.reset())
                .log_on_error("--reinstall cache reset");
        }
        let app = self.app.clone();
        let progress = move |msg: &str| {
            if let Some(state) = app.try_state::<BootstrapState>() {
                state.progressed(msg);
            }
            if let Some(main) = app.get_webview_window(WindowLabel::MAIN) {
                ShellEvent::BootstrapProgress(msg.to_string()).emit_to(&main);
            }
        };
        let controller = self.app.state::<CloudController>().inner().clone();
        // The relay starts with the app, idle on the local side. One that
        // cannot bind leaves the app on this computer.
        if let Err(e) = tauri::async_runtime::block_on(controller.start()) {
            eprintln!("igni: the cloud relay could not start: {e}");
        }
        // `cloud` mode (from the verified pack): the account-only backend,
        // never the full one (§6.3, §6.4).
        let supervisor = self.app.state::<BackendSupervisor>();
        let conn = if controller.starts_in_cloud_mode() {
            progress("Starting igni's account service…");
            supervisor.connect_account_only(&progress)?
        } else {
            supervisor.connect(self.launch.project_dir(), &progress)?
        };
        if let Some(generation) = supervisor.owned_generation() {
            watch_for_crash(self.app, self.launch, generation);
        }
        // The side the account last chose, if igni server still allows it.
        controller.launch();
        let cloud_url = match controller.target() {
            WindowTarget::Relay => controller.window_url(None),
            WindowTarget::Local | WindowTarget::SignIn => None,
        };

        if let Some(main) = self.app.get_webview_window(WindowLabel::MAIN) {
            // The FE replaces this on its first status update; it covers a
            // backend that never connects.
            main.set_title(&WindowTitle::for_dir(self.launch.project_dir()))
                .log_on_error("setting the main window title");
            WindowManager::navigate(&main, cloud_url.as_deref().unwrap_or(&conn.app_url(None)));
        }
        // After a restart the other windows still point at the old port.
        // None exist on the first bootstrap.
        for (label, window) in self.app.webview_windows() {
            if label == WindowLabel::MAIN {
                continue;
            }
            match (window.url(), cloud_url.as_deref()) {
                (_, Some(cloud)) => WindowManager::navigate(&window, cloud),
                (Ok(current), None) => WindowManager::navigate(&window, &rebound_route(&current, &conn)),
                (Err(e), None) => eprintln!("igni: reconnecting window {label}: {e}"),
            }
        }
        Ok(())
    }

    /// Run on a background thread so the loading window stays responsive.
    /// A failure is sent to `loading.html`'s error handler and then written
    /// over the page, so it shows even when the page had not subscribed
    /// yet (an event emitted before its listener is lost).
    pub fn spawn_in_background(app: &AppHandle, launch: LaunchArgs) {
        Self::spawn_in_background_after(app, launch, |_| Ok(()));
    }

    /// As `spawn_in_background`, running `before` on the same thread first
    /// (stopping the old backend for a restart, which can take the
    /// shutdown grace).
    fn spawn_in_background_after(
        app: &AppHandle,
        launch: LaunchArgs,
        before: impl FnOnce(&AppHandle) -> Result<(), ShellError> + Send + 'static,
    ) {
        let app = app.clone();
        if let Some(state) = app.try_state::<BootstrapState>() {
            state.started();
        }
        std::thread::spawn(move || {
            if let Err(e) = before(&app).and_then(|()| Bootstrap::new(&app, &launch).run()) {
                let message = e.to_string();
                if let Some(state) = app.try_state::<BootstrapState>() {
                    state.failed(&message);
                }
                if let Some(main) = app.get_webview_window(WindowLabel::MAIN) {
                    ShellEvent::BootstrapError(message.clone()).emit_to(&main);
                    main.eval(failure_script(&message))
                        .log_on_error("showing the bootstrap failure");
                }
                eprintln!("igni bootstrap failed: {message}");
            }
        });
    }
}

/// The script that replaces the loading page with the failure. The message
/// is set as text, never markup: it can quote the backend's stderr.
fn failure_script(message: &str) -> String {
    let text = serde_json::Value::from(format!("Bootstrap failed: {message}"));
    format!(
        "(function () {{ const node = document.createElement('div'); \
         node.className = 'igni-loading-error'; node.textContent = {text}; \
         document.body.replaceChildren(node); }})();"
    )
}

/// Wipe the managed runtime and bootstrap again. Wired to File ›
/// Reinstall Backend (Clean).
#[tauri::command]
pub(crate) fn reinstall_backend(app: AppHandle) -> Result<(), ShellError> {
    app.state::<BackendSupervisor>().release_for_reinstall()?;
    ManagedRuntime::locate()?.reset()?;
    if let Some(main) = app.get_webview_window(WindowLabel::MAIN) {
        WindowManager::navigate(&main, REINSTALL_ROUTE);
    }
    let launch = app.state::<LaunchArgs>().inner().clone();
    Bootstrap::spawn_in_background(&app, launch);
    Ok(())
}

/// Stop the backend this app spawned and start a fresh one, then point
/// every window at it. Wired to File › Restart Backend. Refused for a
/// backend another client started. It used to close only the web UI's
/// socket, so the old backend kept running and the window waited on
/// "Connecting to backend…" for good (R619).
pub(crate) fn restart_backend(app: AppHandle) -> Result<(), ShellError> {
    app.state::<BackendSupervisor>().check_restartable()?;
    if let Some(main) = app.get_webview_window(WindowLabel::MAIN) {
        WindowManager::navigate(&main, RESTART_ROUTE);
    }
    let launch = app.state::<LaunchArgs>().inner().clone();
    Bootstrap::spawn_in_background_after(&app, launch, |app| {
        app.state::<BackendSupervisor>().release_for_restart()
    });
    Ok(())
}

/// Watch backend number `generation`, which this app spawned. If it dies
/// without being asked to (a crash, an OOM kill, someone's `kill -9`), the
/// main window shows that, a new backend is spawned and every window is
/// pointed at it, as Restart Backend does. Before this a crashed backend
/// left every window on "Connecting…" until someone chose Restart Backend
/// (R619). A backend that keeps dying is replaced three times in five
/// minutes (`CrashBudget` in `backend/supervisor.rs`), then left for the
/// person to restart.
///
/// The watcher ends as soon as its backend is no longer the app's current
/// one: Restart, Reinstall and exit replace or release it themselves, and
/// the bootstrap that spawns the next backend starts the next watcher.
fn watch_for_crash(app: &AppHandle, launch: &LaunchArgs, generation: u64) {
    let app = app.clone();
    let launch = launch.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(CRASH_POLL);
        let supervisor = app.state::<BackendSupervisor>();
        match supervisor.liveness(generation) {
            Liveness::Running => continue,
            Liveness::Replaced => return,
            Liveness::Exited => {
                if !supervisor.release_crashed(generation) {
                    return;
                }
                let main = app.get_webview_window(WindowLabel::MAIN);
                if !supervisor.spend_crash(Instant::now()) {
                    eprintln!("igni: the backend keeps stopping; not starting it again");
                    if let Some(main) = main {
                        WindowManager::navigate(&main, CRASH_GIVE_UP_ROUTE);
                    }
                    return;
                }
                eprintln!("igni: the backend stopped on its own; starting a new one");
                if let Some(main) = main {
                    WindowManager::navigate(&main, CRASH_ROUTE);
                }
                Bootstrap::spawn_in_background(&app, launch);
                return;
            }
        }
    });
}

/// Where a window opened onto a folder of its own (New Window) goes once
/// the backend is back: the new backend's URL, on the same folder.
fn rebound_route(current: &tauri::Url, conn: &BackendConn) -> String {
    let dir = current
        .query_pairs()
        .find(|(key, _)| key == "dir")
        .map(|(_, value)| value.into_owned());
    conn.app_url(dir.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::BackendVersionInfo;

    #[test]
    fn a_window_comes_back_on_its_own_folder_and_the_new_port() {
        let old = tauri::Url::parse(
            "tauri://localhost/index.html?ws=ws%3A%2F%2F127.0.0.1%3A4100&host=tauri&dir=%2Fhome%2Fme%2Fmy%20proj%26x",
        )
        .unwrap();
        let conn = BackendConn::new(4200, None, BackendVersionInfo::discovered("1".into()));
        let route = rebound_route(&old, &conn);
        assert!(route.contains("ws=ws%3A%2F%2F127.0.0.1%3A4200"), "{route}");
        assert!(!route.contains("4100"), "{route}");
        assert!(
            route.contains("&dir=%2Fhome%2Fme%2Fmy%20proj%26x"),
            "{route}"
        );
    }

    #[test]
    fn a_window_without_a_folder_comes_back_without_one() {
        let old = tauri::Url::parse("tauri://localhost/index.html?ws=x").unwrap();
        let conn = BackendConn::new(4200, None, BackendVersionInfo::discovered("1".into()));
        assert!(!rebound_route(&old, &conn).contains("dir="));
    }

    #[test]
    fn a_failure_is_kept_for_a_page_that_was_not_listening_yet() {
        let state = BootstrapState::default();
        state.started();
        state.progressed("Preparing the igni backend…");
        state.failed("igni is air-gapped (air_gapped: true)…");
        assert_eq!(
            state.snapshot(),
            BootstrapSnapshot {
                progress: Some("Preparing the igni backend…".into()),
                error: Some("igni is air-gapped (air_gapped: true)…".into()),
            }
        );
        // A restart or a reinstall starts over.
        state.started();
        assert_eq!(state.snapshot(), BootstrapSnapshot::default());
    }

    #[test]
    fn every_backend_wait_is_a_loading_view_with_its_message() {
        for route in [
            REINSTALL_ROUTE,
            RESTART_ROUTE,
            CRASH_ROUTE,
            CRASH_GIVE_UP_ROUTE,
        ] {
            let url = tauri::Url::parse(&format!("tauri://localhost/{route}")).unwrap();
            assert_eq!(url.path(), "/loading.html", "{route}");
            let msg = url
                .query_pairs()
                .find(|(k, _)| k == "msg")
                .map(|(_, v)| v.into_owned());
            assert!(msg.is_some_and(|m| !m.is_empty()), "{route}");
            assert!(
                url.fragment().is_none(),
                "a '#' would cut the message: {route}"
            );
        }
    }

    #[test]
    fn the_failure_replaces_the_page_with_the_message() {
        let script = failure_script("backend exited before signalling ready: boom");
        assert!(script.contains("document.body.replaceChildren(node)"));
        assert!(script.contains("node.className = 'igni-loading-error'"));
        assert!(
            script.contains("\"Bootstrap failed: backend exited before signalling ready: boom\"")
        );
    }

    #[test]
    fn the_message_is_text_not_markup() {
        // A quote cannot close the literal, and markup is never parsed.
        let script = failure_script("bad <img src=x onerror=alert(1)> \"quoted\" 'single'");
        assert!(!script.contains("innerHTML"));
        assert!(script.contains("node.textContent = \"Bootstrap failed: bad <img src=x onerror=alert(1)> \\\"quoted\\\" 'single'\""));
    }
}
