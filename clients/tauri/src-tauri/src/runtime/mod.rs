//! Managed-runtime bootstrap.
//!
//! On first launch the Tauri shell self-provisions everything the BE
//! needs: downloads ``uv``, asks uv to install a pinned CPython, creates a
//! managed venv, installs ``igni-core`` at the pinned version, and
//! prefetches igni's decision model (Laya). Subsequent launches reuse the
//! cache and skip straight to spawning the BE.
//!
//! The interpreter is chosen in this order: an acknowledged developer
//! override ([`DevOverride`]), an interpreter the installer provisioned
//! ([`ProvisionedRuntime`]), else the managed cache ([`ManagedRuntime`]).

mod dev_override;
mod install_plan;
mod interpreter;
mod managed;
mod marker;
mod provisioned;
mod uv;

use std::path::PathBuf;

use crate::desktop_settings::DesktopSettings;

pub(crate) use dev_override::DevOverride;
pub(crate) use interpreter::{is_executable, probe_cli_version};
pub(crate) use managed::ManagedRuntime;
pub(crate) use provisioned::ProvisionedRuntime;

const PYTHON_VERSION: &str = "3.12";
const UV_VERSION: &str = "0.5.7";
/// Also the wire version discovery compares a running backend's
/// lockfile against — the BE stamps its own package `__version__`
/// there, and this is the version we pin it to. See `discovery.rs`.
pub(crate) const IGNI_CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The variable naming a provisioned interpreter; wins over the setting.
pub(crate) const RUNTIME_PYTHON_ENV: &str = "IGNI_RUNTIME_PYTHON";

/// The Python interpreter to spawn the BE with, plus env vars the caller
/// layers onto the BE process.
///
/// ``actual_cli_version`` is the ``igni_core.__version__`` reported by the
/// chosen interpreter, captured at bootstrap time so ``backend/conn.rs``
/// can propagate it into the WKWebView URL, where the web bundle's
/// ``BackendVersionChip`` warns when it drifts from the pinned build.
/// ``None`` when the probe failed.
pub struct BackendInstall {
    pub python: PathBuf,
    pub env: Vec<(String, String)>,
    pub actual_cli_version: Option<String>,
    pub expected_cli_version: String,
    pub source: BackendSource,
}

/// How the interpreter was resolved. Surfaced in the UI so a user on a dev
/// override or a bit-rotted venv can *see* it without digging through logs.
#[derive(Debug, Clone, Copy)]
pub enum BackendSource {
    ManagedVenv,
    DevOverride,
    /// An interpreter the installer provisioned (`runtime_python`).
    Provisioned,
}

impl BackendSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            BackendSource::ManagedVenv => "managed_venv",
            BackendSource::DevOverride => "dev_override",
            BackendSource::Provisioned => "provisioned",
        }
    }
}

/// Progress callback signature — short human-readable status strings the
/// caller surfaces in the loading view ("Downloading uv…" / …).
pub type ProgressFn<'a> = &'a (dyn Fn(&str) + Sync);

/// Resolve a Python interpreter with ``igni-core`` installed and its
/// decision model pre-warmed. Bootstraps on first call; returns the cached
/// install on subsequent calls.
///
/// Returns a human-readable message on any failure; the caller surfaces it
/// in the UI.
pub fn ensure_backend_python(progress: ProgressFn) -> Result<BackendInstall, String> {
    let expected = IGNI_CORE_VERSION.to_string();
    if let Some(install) = DevOverride::from_env().install(&expected) {
        return Ok(install);
    }
    let runtime_python = std::env::var(RUNTIME_PYTHON_ENV).ok();
    if let Some(provisioned) =
        ProvisionedRuntime::named(runtime_python.as_deref(), &DesktopSettings::load())
    {
        return provisioned.install(expected, probe_cli_version);
    }
    ManagedRuntime::locate()?.ensure(progress, expected)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The wire shape of ``backend_source`` (in URL query params and
    // ``<meta>`` tags) is what the web bundle's ``BackendVersionChip``
    // matches on, so pin the wire values.
    #[test]
    fn backend_source_serializes_as_stable_strings() {
        assert_eq!(BackendSource::ManagedVenv.as_str(), "managed_venv");
        assert_eq!(BackendSource::DevOverride.as_str(), "dev_override");
        assert_eq!(BackendSource::Provisioned.as_str(), "provisioned");
    }
}
