//! Deciding, without touching the disk or the network, what the managed
//! runtime's bootstrap has to (re)do.
//!
//! Each component is versioned on its own: an igni release changes only
//! `ignite`, so it reinstalls only the package into the existing venv and
//! keeps the downloaded uv, the Python interpreter, the venv and the
//! decision model.

use serde::{Deserialize, Serialize};

use super::{IGNI_CORE_VERSION, PYTHON_VERSION, UV_VERSION};

/// The versions of the three things the managed runtime is made of, as the
/// install marker records them and as this build wants them. ``None`` is
/// unknown or not installed, which redoes that component.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct ComponentVersions {
    pub uv: Option<String>,
    pub python: Option<String>,
    pub ignite: Option<String>,
}

impl ComponentVersions {
    pub fn current() -> Self {
        Self::of(UV_VERSION, PYTHON_VERSION, IGNI_CORE_VERSION)
    }

    pub fn of(uv: &str, python: &str, ignite: &str) -> Self {
        Self {
            uv: Some(uv.to_string()),
            python: Some(python.to_string()),
            ignite: Some(ignite.to_string()),
        }
    }
}

/// What the cache holds right now.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct InstalledState {
    pub recorded: ComponentVersions,
    pub uv_present: bool,
    pub venv_present: bool,
    /// The igni-core the venv's interpreter reports; ``None`` when it is
    /// missing or the probe failed.
    pub venv_reports: Option<String>,
}

/// What the bootstrap has to (re)do.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct InstallPlan {
    pub fetch_uv: bool,
    /// Wipe and recreate the venv (installs the Python first).
    pub rebuild_venv: bool,
    /// ``uv pip install igni-core==X`` into the venv, then prefetch.
    pub install_ignite: bool,
    /// The interpreter reports an igni-core other than the one wanted.
    pub venv_version_mismatch: bool,
}

impl InstallPlan {
    /// Only a positive mismatch acts on the probed version: a failed probe
    /// (interpreter missing or wedged) falls back to the marker and the
    /// files present, so a transient hiccup does not trigger a multi-minute
    /// reinstall on every startup.
    pub fn new(have: &InstalledState, want: &ComponentVersions) -> Self {
        let fetch_uv = !have.uv_present || have.recorded.uv != want.uv;
        let rebuild_venv = !have.venv_present || have.recorded.python != want.python;
        let venv_version_mismatch = matches!(
            (have.venv_reports.as_deref(), want.ignite.as_deref()),
            (Some(a), Some(w)) if a != w
        );
        let install_ignite =
            rebuild_venv || have.recorded.ignite != want.ignite || venv_version_mismatch;
        InstallPlan {
            fetch_uv,
            rebuild_venv,
            install_ignite,
            venv_version_mismatch,
        }
    }

    /// Whether anything has to be downloaded.
    pub fn any(&self) -> bool {
        self.fetch_uv || self.rebuild_venv || self.install_ignite
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(uv: &str, python: &str, ignite: &str) -> ComponentVersions {
        ComponentVersions::of(uv, python, ignite)
    }

    fn state(
        recorded: ComponentVersions,
        uv_present: bool,
        venv_present: bool,
        reports: Option<&str>,
    ) -> InstalledState {
        InstalledState {
            recorded,
            uv_present,
            venv_present,
            venv_reports: reports.map(str::to_string),
        }
    }

    fn want() -> ComponentVersions {
        v("0.5.7", "3.12", "1.0.3")
    }

    #[test]
    fn an_up_to_date_install_does_nothing() {
        let plan = InstallPlan::new(&state(want(), true, true, Some("1.0.3")), &want());
        assert_eq!(plan, InstallPlan::default());
        assert!(!plan.any());
    }

    #[test]
    fn an_igni_only_bump_reinstalls_only_the_package() {
        let plan = InstallPlan::new(
            &state(v("0.5.7", "3.12", "1.0.2"), true, true, Some("1.0.2")),
            &want(),
        );
        assert!(plan.install_ignite);
        assert!(!plan.fetch_uv, "uv is kept");
        assert!(!plan.rebuild_venv, "the Python and the venv are kept");
    }

    #[test]
    fn a_python_bump_rebuilds_the_venv_and_keeps_uv() {
        let plan = InstallPlan::new(
            &state(v("0.5.7", "3.11", "1.0.3"), true, true, Some("1.0.3")),
            &want(),
        );
        assert!(plan.rebuild_venv && plan.install_ignite);
        assert!(!plan.fetch_uv);
    }

    #[test]
    fn a_uv_bump_refetches_uv_and_keeps_the_venv() {
        let plan = InstallPlan::new(
            &state(v("0.5.6", "3.12", "1.0.3"), true, true, Some("1.0.3")),
            &want(),
        );
        assert!(plan.fetch_uv);
        assert!(!plan.rebuild_venv && !plan.install_ignite);
    }

    #[test]
    fn a_missing_uv_is_fetched_whatever_the_marker_says() {
        let plan = InstallPlan::new(&state(want(), false, true, Some("1.0.3")), &want());
        assert!(plan.fetch_uv && !plan.rebuild_venv && !plan.install_ignite);
    }

    #[test]
    fn a_missing_venv_is_rebuilt_whatever_the_marker_says() {
        let plan = InstallPlan::new(&state(want(), true, false, None), &want());
        assert!(plan.rebuild_venv && plan.install_ignite);
        assert!(!plan.fetch_uv);
    }

    #[test]
    fn a_venv_reporting_another_igni_is_reinstalled() {
        // Marker matches, wheels on disk do not (a manual pip upgrade, an
        // install that skipped the marker rewrite).
        let plan = InstallPlan::new(&state(want(), true, true, Some("1.0.9")), &want());
        assert!(plan.venv_version_mismatch && plan.install_ignite);
        assert!(
            !plan.fetch_uv && !plan.rebuild_venv,
            "the package is reinstalled in place"
        );
    }

    #[test]
    fn a_failed_probe_is_not_a_mismatch() {
        let plan = InstallPlan::new(&state(want(), true, true, None), &want());
        assert!(!plan.venv_version_mismatch && !plan.any());
    }

    #[test]
    fn no_marker_redoes_everything() {
        let plan = InstallPlan::new(
            &state(ComponentVersions::default(), true, true, Some("1.0.3")),
            &want(),
        );
        assert!(plan.fetch_uv && plan.rebuild_venv && plan.install_ignite);
    }
}
