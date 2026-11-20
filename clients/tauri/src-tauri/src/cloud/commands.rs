//! The Tauri commands of the switch (§10): `backend_state`,
//! `switch_backend`, `cloud_sign_in`, `account_rpc`, and the few the
//! banners and the badge need. None of them takes or returns a token.

use serde::Deserialize;
use serde_json::Value;
use tauri::{State, WebviewWindow};

use super::controller::CloudController;
use super::state::Side;
use super::switchboard::{BackendSnapshot, WindowActivity};

/// The side and state every window renders.
#[tauri::command]
pub(crate) fn backend_state(controller: State<'_, CloudController>) -> BackendSnapshot {
    controller.snapshot()
}

/// Flip the app to `side` (`"local"` or `"cloud"`). Refused, with the
/// reason as text, when the mode or igni server does not allow it.
#[tauri::command]
pub(crate) async fn switch_backend(controller: State<'_, CloudController>, side: Side) -> Result<(), String> {
    let controller = controller.inner().clone();
    tauri::async_runtime::spawn_blocking(move || controller.switch(side))
        .await
        .map_err(|e| e.to_string())?
}

/// **Sign in** on the "needs you to sign in again" banner.
#[tauri::command]
pub(crate) async fn cloud_sign_in(controller: State<'_, CloudController>) -> Result<(), String> {
    let controller = controller.inner().clone();
    tauri::async_runtime::spawn_blocking(move || controller.cloud_sign_in())
        .await
        .map_err(|e| e.to_string())?
}

/// **Retry** on the unreachable banner: dial now.
#[tauri::command]
pub(crate) fn cloud_retry(controller: State<'_, CloudController>) {
    controller.retry();
}

/// Dismiss a notice, or a refusal already handled.
#[tauri::command]
pub(crate) fn dismiss_backend_notice(controller: State<'_, CloudController>) {
    controller.dismiss();
}

/// A window's local runs and approvals, for the badge and for a move to
/// the cloud that waits on them.
#[derive(Debug, Deserialize)]
pub(crate) struct ActivityReport {
    #[serde(default)]
    session_id: String,
    #[serde(default)]
    runs: u32,
    #[serde(default)]
    approvals: u32,
}

#[tauri::command]
pub(crate) fn report_local_activity(window: WebviewWindow, controller: State<'_, CloudController>, report: ActivityReport) {
    controller.report_activity(
        window.label(),
        WindowActivity { session_id: report.session_id, runs: report.runs, approvals: report.approvals },
    );
}

/// An account call on this computer's backend (allow-listed).
#[tauri::command]
pub(crate) async fn account_rpc(controller: State<'_, CloudController>, method: String, args: Option<Value>) -> Result<Value, String> {
    let controller = controller.inner().clone();
    controller.account_rpc(&method, args.unwrap_or(Value::Object(Default::default()))).await
}
