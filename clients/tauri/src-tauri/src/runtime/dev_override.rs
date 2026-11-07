//! The developer override: ``IGNI_DEV_BACKEND`` or ``IGNI_PYTHON`` naming an
//! interpreter, honoured only with ``IGNITE_EMBER_DEV`` acknowledging it.
//!
//! Both variables are escape hatches for contributors running against an
//! editable checkout. The explicit acknowledgement means an ambient variable
//! left in ``~/.zshenv`` or a launchd plist cannot silently redirect a
//! regular user to a stale interpreter — the footgun that hid a v0.3.8
//! Homebrew CLI behind a v0.8.x plugin.

use std::path::PathBuf;

use super::interpreter::probe_cli_version;
use super::{BackendInstall, BackendSource};

const DEV_BACKEND_ENV: &str = "IGNI_DEV_BACKEND";
const IGNI_PYTHON_ENV: &str = "IGNI_PYTHON";
const DEV_ACK_ENV: &str = "IGNITE_EMBER_DEV";

/// The override variables, as the environment states them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DevOverride {
    dev_backend: Option<String>,
    igni_python: Option<String>,
    ack: Option<String>,
}

impl DevOverride {
    pub fn new(
        dev_backend: Option<String>,
        igni_python: Option<String>,
        ack: Option<String>,
    ) -> Self {
        DevOverride {
            dev_backend,
            igni_python,
            ack,
        }
    }

    pub fn from_env() -> Self {
        DevOverride::new(
            std::env::var(DEV_BACKEND_ENV).ok(),
            std::env::var(IGNI_PYTHON_ENV).ok(),
            std::env::var(DEV_ACK_ENV).ok(),
        )
    }

    pub fn dev_backend(&self) -> Option<&str> {
        self.dev_backend.as_deref()
    }

    pub fn igni_python(&self) -> Option<&str> {
        self.igni_python.as_deref()
    }

    pub fn ack(&self) -> Option<&str> {
        self.ack.as_deref()
    }

    /// Only ``1`` or a case-insensitive ``true`` acknowledges; anything else,
    /// including unset, does not.
    pub fn is_active(&self) -> bool {
        self.ack
            .as_deref()
            .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"))
    }

    /// The interpreter the overrides name, if they are in force.
    /// ``IGNI_DEV_BACKEND`` wins over ``IGNI_PYTHON``.
    pub fn override_path(&self) -> Option<PathBuf> {
        if !self.is_active() {
            return None;
        }
        self.named().map(|(_, path)| PathBuf::from(path))
    }

    /// Whether any override variable is set, acknowledged or not.
    pub fn override_set(&self) -> bool {
        self.named().is_some()
    }

    /// The install the override resolves to, or ``None`` (after saying so
    /// when a variable is set without the acknowledgement) for the next
    /// resolver to decide.
    pub fn install(&self, expected: &str) -> Option<BackendInstall> {
        let (variable, path) = self.named()?;
        if !self.is_active() {
            eprintln!(
                "{variable}={path} detected but {DEV_ACK_ENV} is unset — ignoring override and using \
                 the managed venv. Set {DEV_ACK_ENV}=1 to opt in to the dev-mode override."
            );
            return None;
        }
        let python = PathBuf::from(path);
        let actual = probe_cli_version(&python);
        if let Some(v) = actual.as_deref().filter(|v| *v != expected) {
            eprintln!("{variable} at {path} runs igni-core {v}, plugin pinned to {expected}. Continuing (dev mode).");
        }
        Some(BackendInstall {
            python,
            env: vec![],
            actual_cli_version: actual,
            expected_cli_version: expected.to_string(),
            source: BackendSource::DevOverride,
        })
    }

    /// The first override variable set to something, with its name.
    fn named(&self) -> Option<(&'static str, &str)> {
        Self::non_empty(&self.dev_backend)
            .map(|p| (DEV_BACKEND_ENV, p))
            .or_else(|| Self::non_empty(&self.igni_python).map(|p| (IGNI_PYTHON_ENV, p)))
    }

    fn non_empty(value: &Option<String>) -> Option<&str> {
        value.as_deref().map(str::trim).filter(|s| !s.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev(dev_backend: Option<&str>, igni_python: Option<&str>, ack: Option<&str>) -> DevOverride {
        DevOverride::new(
            dev_backend.map(str::to_string),
            igni_python.map(str::to_string),
            ack.map(str::to_string),
        )
    }

    fn acked(value: &str) -> bool {
        dev(None, None, Some(value)).is_active()
    }

    // The override should be controlled by an *explicit* ack, not by the
    // presence of an ambient env var. These pin exactly what counts as
    // acknowledged so a relaxation doesn't re-open the silent hijack.

    #[test]
    fn one_and_true_acknowledge() {
        assert!(acked("1"));
        assert!(acked("true") && acked("True") && acked("TRUE"));
    }

    #[test]
    fn zero_empty_and_other_truthy_words_do_not() {
        for value in ["0", "", "yes", "on", "enable"] {
            assert!(!acked(value), "{value:?}");
        }
        assert!(!dev(None, None, None).is_active());
    }

    #[test]
    fn the_dev_backend_variable_wins_over_igni_python() {
        let env = dev(Some("/a"), Some("/b"), Some("1"));
        assert_eq!(env.override_path(), Some(PathBuf::from("/a")));
    }

    #[test]
    fn a_blank_variable_does_not_count() {
        let env = dev(Some("  "), Some(" /py/python "), Some("TRUE"));
        assert_eq!(env.override_path(), Some(PathBuf::from("/py/python")));
        assert!(!dev(Some(" "), None, None).override_set());
    }

    #[test]
    fn an_unacknowledged_override_installs_nothing() {
        let env = dev(Some("/dev/python"), None, None);
        assert!(env.override_set());
        assert_eq!(env.override_path(), None);
        assert!(env.install("1.0.3").is_none());
    }

    #[test]
    fn an_acknowledged_override_is_the_interpreter_whatever_it_runs() {
        let install = dev(None, Some("/nonexistent/python"), Some("1"))
            .install("1.0.3")
            .expect("used");
        assert_eq!(install.python, PathBuf::from("/nonexistent/python"));
        assert_eq!(install.source.as_str(), "dev_override");
        assert_eq!(install.actual_cli_version, None);
        assert!(install.env.is_empty());
    }
}
