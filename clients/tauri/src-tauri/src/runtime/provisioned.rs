//! An interpreter the installer provisioned.
//!
//! The supported way to run the desktop app where it cannot download its
//! runtime — an air-gapped network, or a locked-down estate. Whoever
//! installs the app installs `igni-core[decisions]` from their own mirror
//! into an interpreter and names it in `IGNI_RUNTIME_PYTHON` or the
//! `runtime_python` setting. Unlike `IGNI_PYTHON` it needs no
//! `IGNITE_EMBER_DEV=1`: it is an administrator's decision, written in the
//! settings an administrator owns.

use std::path::{Path, PathBuf};

use crate::desktop_settings::DesktopSettings;

use super::interpreter::is_executable;
use super::{BackendInstall, BackendSource, RUNTIME_PYTHON_ENV};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProvisionedRuntime {
    python: PathBuf,
}

impl ProvisionedRuntime {
    /// The interpreter this install was provisioned with, if it names one:
    /// the variable's value, else `runtime_python` in the settings files.
    pub fn named(env: Option<&str>, settings: &DesktopSettings) -> Option<Self> {
        env.map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| settings.runtime_python.clone())
            .map(|python| ProvisionedRuntime {
                python: PathBuf::from(python),
            })
    }

    /// Use the interpreter, or say why it cannot be used. Never falls back
    /// to downloading: the administrator chose this one.
    pub fn install(
        self,
        expected: String,
        probe: impl Fn(&Path) -> Option<String>,
    ) -> Result<BackendInstall, String> {
        let python = self.python;
        if !is_executable(&python) {
            return Err(format!(
                "runtime_python ({}) is not an executable. Point it (or {RUNTIME_PYTHON_ENV}) at the \
                 interpreter igni-core is installed in.",
                python.display()
            ));
        }
        let Some(actual) = probe(&python) else {
            return Err(format!(
                "runtime_python ({}) runs, but cannot import igni_core. Install \
                 igni-core[decisions]=={expected} into it from your package mirror.",
                python.display()
            ));
        };
        if actual != expected {
            // Shown in the app too (the version chip); not fatal, as with the
            // managed venv after a manual upgrade.
            eprintln!(
                "runtime_python at {} runs igni-core {actual}; this app is built for {expected}.",
                python.display()
            );
        }
        Ok(BackendInstall {
            python,
            env: vec![],
            actual_cli_version: Some(actual),
            expected_cli_version: expected,
            source: BackendSource::Provisioned,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::super::probe_cli_version;
    use super::*;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn settings(runtime_python: Option<&str>) -> DesktopSettings {
        DesktopSettings {
            runtime_python: runtime_python.map(str::to_string),
            ..DesktopSettings::default()
        }
    }

    fn at(python: &str) -> ProvisionedRuntime {
        ProvisionedRuntime {
            python: PathBuf::from(python),
        }
    }

    #[test]
    fn the_variable_wins_over_the_setting() {
        assert_eq!(
            ProvisionedRuntime::named(Some("/env/python"), &settings(Some("/cfg/python"))),
            Some(at("/env/python"))
        );
        assert_eq!(
            ProvisionedRuntime::named(Some("  "), &settings(Some("/cfg/python"))),
            Some(at("/cfg/python"))
        );
        assert_eq!(
            ProvisionedRuntime::named(None, &settings(None)),
            None,
            "nothing named: the managed venv"
        );
    }

    #[test]
    fn a_provisioned_runtime_needs_no_dev_acknowledgement() {
        // The selection reads only the variable and the settings; IGNITE_EMBER_DEV
        // is not among its inputs, which is the difference from IGNI_PYTHON.
        let src = include_str!("provisioned.rs");
        let body = src
            .split("pub fn named")
            .nth(1)
            .unwrap()
            .split("\n    }\n")
            .next()
            .unwrap();
        assert!(!body.contains("DevOverride") && !body.contains("IGNITE_EMBER_DEV"));
    }

    #[test]
    fn a_missing_interpreter_is_refused_with_the_setting_named() {
        let err = at("/nonexistent/python")
            .install("1.0.3".into(), |_| Some("1.0.3".into()))
            .err()
            .expect("refused");
        assert!(
            err.contains("runtime_python") && err.contains(RUNTIME_PYTHON_ENV),
            "{err}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_provisioned_interpreter_is_used_as_is() {
        let dir = std::env::temp_dir().join(format!("igni-provisioned-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let python = dir.join("python");
        fs::write(&python, "#!/bin/sh\nprintf '1.0.3'\n").unwrap();
        fs::set_permissions(&python, fs::Permissions::from_mode(0o755)).unwrap();
        let install = ProvisionedRuntime {
            python: python.clone(),
        }
        .install("1.0.3".into(), probe_cli_version)
        .expect("used");
        assert_eq!(install.python, python);
        assert_eq!(install.source.as_str(), "provisioned");
        assert_eq!(install.actual_cli_version.as_deref(), Some("1.0.3"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_interpreter_without_igni_is_refused() {
        // `true` exists and is executable everywhere this runs, and has no igni_core.
        let python = if cfg!(windows) {
            "C:/Windows/System32/whoami.exe"
        } else {
            "/usr/bin/true"
        };
        if !is_executable(Path::new(python)) {
            return;
        }
        let err = at(python)
            .install("1.0.3".into(), |_| None)
            .err()
            .expect("refused");
        assert!(err.contains("cannot import igni_core"), "{err}");
    }
}
