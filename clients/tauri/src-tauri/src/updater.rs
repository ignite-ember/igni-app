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
use tauri::{AppHandle, Runtime, Wry};
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

/// Generic over the runtime so a test can drive it on Tauri's mock one;
/// the app itself only ever has the webview runtime, the default.
pub(crate) struct AppUpdater<'a, R: Runtime = Wry> {
    app: &'a AppHandle<R>,
    gate: UpdateGate,
}

impl<'a, R: Runtime> AppUpdater<'a, R> {
    const CURRENT_VERSION: &'static str = env!("CARGO_PKG_VERSION");

    pub fn load(app: &'a AppHandle<R>) -> Self {
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
    use crate::tls_testing::TestMirror;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

    /// The app on Tauri's mock runtime with the real updater plugin, as
    /// `run()` registers it (any public key: no payload gets that far).
    fn app() -> tauri::App<MockRuntime> {
        let mut context = mock_context(noop_assets());
        context
            .config_mut()
            .plugins
            .0
            .insert("updater".into(), json!({ "pubkey": "unused", "endpoints": [] }));
        mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap()
    }

    /// A release newer than any build, for every target the plugin asks
    /// about (its signature is never reached: no test downloads).
    const LATEST: &str = r#"{"version":"999.0.0","notes":"","pub_date":"2026-11-21T00:00:00Z","platforms":{
        "darwin-aarch64":{"url":"https://127.0.0.1/p","signature":"x"},
        "darwin-x86_64":{"url":"https://127.0.0.1/p","signature":"x"},
        "linux-x86_64":{"url":"https://127.0.0.1/p","signature":"x"},
        "linux-aarch64":{"url":"https://127.0.0.1/p","signature":"x"},
        "windows-x86_64":{"url":"https://127.0.0.1/p","signature":"x"}}}"#;

    /// A company mirror once IT has its CA in the system's store: the
    /// check goes through and offers the release. Linux only, where the
    /// store can be swapped for one process (`SSL_CERT_FILE`); the
    /// updater-e2e proof covers all three with the real OS stores.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_mirror_whose_ca_the_system_trusts_offers_its_update() {
        crate::tls_testing::passes_trusting_the_test_ca("updater::tests::check_with_the_test_ca_in_the_system_bundle");
    }

    #[test]
    #[ignore = "run by a_mirror_whose_ca_the_system_trusts_offers_its_update, with SSL_CERT_FILE"]
    fn check_with_the_test_ca_in_the_system_bundle() {
        let mirror = TestMirror::start(LATEST);
        let app = app();
        let updater = AppUpdater {
            app: app.handle(),
            gate: UpdateGate::Endpoint(Some(mirror.url("/latest.json"))),
        };
        let result = tauri::async_runtime::block_on(updater.check()).unwrap();
        assert_eq!(serde_json::to_value(&result).unwrap()["latest_version"], json!("999.0.0"));
        assert_eq!(serde_json::to_value(&result).unwrap()["available"], json!(true));
    }

    #[test]
    fn a_mirror_with_a_certificate_this_computer_does_not_trust_is_refused_and_says_why() {
        let mirror = TestMirror::start(LATEST);
        let endpoint = mirror.url("/latest.json");
        let app = app();
        let updater = AppUpdater {
            app: app.handle(),
            gate: UpdateGate::Endpoint(Some(endpoint.clone())),
        };
        let message = tauri::async_runtime::block_on(updater.check()).unwrap_err().to_string();
        assert!(message.contains(&endpoint), "{message}");
        // The cause, not only "error sending request": a refused
        // certificate must not read like a mirror that is down.
        assert!(message.contains("invalid peer certificate"), "{message}");
        // macOS refuses this leaf first for its 100-year lifetime (the
        // fixture must outlive the suite), so the issuer verdict and its
        // advice are asserted where the verdict is the issuer's.
        #[cfg(not(target_os = "macos"))]
        assert!(message.ends_with(crate::error::CauseChain::UPDATE_SERVER), "{message}");

        let message = tauri::async_runtime::block_on(updater.install()).unwrap_err().to_string();
        assert!(message.contains("invalid peer certificate"), "{message}");
    }

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
