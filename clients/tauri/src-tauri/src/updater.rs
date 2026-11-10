//! Checking for and installing app updates, behind the update policy.
//!
//! [`AppUpdater`] is the only thing in the crate that builds an
//! `Updater`, and it builds one only through [`UpdateGate`], so neither
//! command can reach the network without the policy agreeing.
//!
//! A configured mirror is safe because signature verification does not
//! change: the public key is compiled into `tauri.conf.json`, so a mirror
//! can serve a different version but not a different build. The plugin
//! refuses non-HTTPS endpoints at the builder.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Updater, UpdaterExt};

use crate::error::ShellError;
use crate::update_policy::{UpdatePolicy, UpdateSource};

/// The answer to "is there an update?", shaped like the backend's
/// `check_for_update` RPC so the web `UpdatePrompt` needs no branching.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct UpdateCheckResult {
    available: bool,
    current_version: String,
    latest_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    checks_disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    download_url: Option<String>,
}

impl UpdateCheckResult {
    /// The deployment opted out: nothing to install, no request made.
    pub fn disabled(current: &str) -> Self {
        UpdateCheckResult {
            available: false,
            current_version: current.to_string(),
            latest_version: current.to_string(),
            checks_disabled: Some(true),
            download_url: None,
        }
    }

    pub fn up_to_date(current: &str) -> Self {
        UpdateCheckResult {
            available: false,
            current_version: current.to_string(),
            latest_version: current.to_string(),
            checks_disabled: None,
            download_url: None,
        }
    }

    pub fn available(current: &str, latest: String, download_url: String) -> Self {
        UpdateCheckResult {
            available: true,
            current_version: current.to_string(),
            latest_version: latest,
            checks_disabled: None,
            download_url: Some(download_url),
        }
    }
}

/// What the policy lets the updater do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UpdateGate {
    /// No request at all; carries the reason said to whoever asked.
    Denied(String),
    /// Ask this endpoint, or the compiled one when `None`.
    Endpoint(Option<String>),
}

impl UpdateGate {
    pub fn from_source(source: UpdateSource) -> Self {
        match source {
            UpdateSource::Off(reason) => UpdateGate::Denied(reason),
            UpdateSource::Compiled => UpdateGate::Endpoint(None),
            UpdateSource::Mirror(mirror) => UpdateGate::Endpoint(Some(mirror)),
        }
    }
}

pub(crate) struct AppUpdater<'a> {
    app: &'a AppHandle,
    gate: UpdateGate,
}

impl<'a> AppUpdater<'a> {
    const CURRENT_VERSION: &'static str = env!("CARGO_PKG_VERSION");

    pub fn load(app: &'a AppHandle) -> Self {
        AppUpdater {
            app,
            gate: UpdateGate::from_source(UpdatePolicy::load().source()),
        }
    }

    /// An updater pointed at `endpoint`, or at the compiled one. A
    /// configured endpoint that will not parse, or that the plugin
    /// rejects, is an error rather than a silent fallback to the vendor
    /// host (DEC-11).
    fn updater_for(&self, endpoint: Option<&str>) -> Result<Updater, ShellError> {
        let Some(endpoint) = endpoint else {
            return Ok(self.app.updater()?);
        };
        let url = tauri::Url::parse(endpoint).map_err(|e| ShellError::UpdateEndpointInvalid {
            endpoint: endpoint.to_string(),
            reason: e.to_string(),
        })?;
        let builder = self
            .app
            .updater_builder()
            .endpoints(vec![url])
            .map_err(|source| ShellError::UpdateEndpointRefused {
                endpoint: endpoint.to_string(),
                source,
            })?;
        Ok(builder.build()?)
    }

    /// The updater this install may use, or `None` when the policy says
    /// to make no request.
    pub fn permitted(&self) -> Result<Option<Updater>, ShellError> {
        match &self.gate {
            UpdateGate::Denied(_) => Ok(None),
            UpdateGate::Endpoint(endpoint) => self.updater_for(endpoint.as_deref()).map(Some),
        }
    }

    /// The updater, or the policy's reason for refusing one.
    pub fn require(&self) -> Result<Updater, ShellError> {
        match &self.gate {
            UpdateGate::Denied(reason) => Err(ShellError::UpdatesOff(reason.clone())),
            UpdateGate::Endpoint(endpoint) => self.updater_for(endpoint.as_deref()),
        }
    }

    pub async fn check(&self) -> Result<UpdateCheckResult, ShellError> {
        let Some(updater) = self.permitted()? else {
            return Ok(UpdateCheckResult::disabled(Self::CURRENT_VERSION));
        };
        Ok(match updater.check().await? {
            Some(update) => UpdateCheckResult::available(
                Self::CURRENT_VERSION,
                update.version,
                update.download_url.to_string(),
            ),
            None => UpdateCheckResult::up_to_date(Self::CURRENT_VERSION),
        })
    }

    /// Download, verify and install the pending update, then relaunch.
    /// Gated like `check`: a banner that outlived a config change must not
    /// make the bigger request.
    pub async fn install(&self) -> Result<(), ShellError> {
        let update = self
            .require()?
            .check()
            .await?
            .ok_or(ShellError::NoUpdatePending)?;
        update
            .download_and_install(|_chunk, _total| {}, || {})
            .await?;
        self.app.restart();
    }
}

/// Whether a newer release exists. Makes no request when the policy is
/// off (`update_check_ttl: 0`, or air-gapped without a mirror).
#[tauri::command]
pub(crate) async fn igni_check_update(app: AppHandle) -> Result<UpdateCheckResult, ShellError> {
    AppUpdater::load(&app).check().await
}

/// The update banner's Install button.
#[tauri::command]
pub(crate) async fn igni_install_update(app: AppHandle) -> Result<(), ShellError> {
    AppUpdater::load(&app).install().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_disabled_check_serializes_as_before() {
        assert_eq!(
            serde_json::to_value(UpdateCheckResult::disabled("1.0.3")).unwrap(),
            json!({
                "available": false,
                "current_version": "1.0.3",
                "latest_version": "1.0.3",
                "checks_disabled": true,
            })
        );
    }

    #[test]
    fn an_available_update_serializes_as_before() {
        assert_eq!(
            serde_json::to_value(UpdateCheckResult::available(
                "1.0.3",
                "1.0.4".into(),
                "https://example.invalid/igni.tar.gz".into()
            ))
            .unwrap(),
            json!({
                "available": true,
                "current_version": "1.0.3",
                "latest_version": "1.0.4",
                "download_url": "https://example.invalid/igni.tar.gz",
            })
        );
    }

    #[test]
    fn an_up_to_date_check_serializes_as_before() {
        assert_eq!(
            serde_json::to_value(UpdateCheckResult::up_to_date("1.0.3")).unwrap(),
            json!({
                "available": false,
                "current_version": "1.0.3",
                "latest_version": "1.0.3",
            })
        );
    }

    #[test]
    fn an_off_policy_denies_with_its_reason() {
        assert_eq!(
            UpdateGate::from_source(UpdateSource::Off("air-gapped".into())),
            UpdateGate::Denied("air-gapped".into())
        );
    }

    #[test]
    fn the_compiled_and_mirror_sources_name_their_endpoint() {
        assert_eq!(
            UpdateGate::from_source(UpdateSource::Compiled),
            UpdateGate::Endpoint(None)
        );
        assert_eq!(
            UpdateGate::from_source(UpdateSource::Mirror("https://m.internal/l.json".into())),
            UpdateGate::Endpoint(Some("https://m.internal/l.json".into()))
        );
    }
}
