//! File › Diagnose Backend: a one-click triage report for bug reports.

use std::fmt;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::backend::BackendSupervisor;
use crate::desktop_settings::DesktopSettings;
use crate::runtime::{self, DevOverride, ManagedRuntime, ProvisionedRuntime, RUNTIME_PYTHON_ENV};

/// The marker shows its own placeholder when the probe fails.
const PROBE_FAILED: &str = "<probe failed>";
const UNSET: &str = "<unset>";

#[derive(Debug, Clone, PartialEq, Eq)]
struct VersionReport {
    app_version: String,
    actual: String,
}

/// Which backend the window is on, resolved as `ensure_backend_python`
/// resolves it — or one another igni client started, which the window
/// attached to instead of spawning.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Source {
    DevOverride,
    Provisioned,
    ManagedVenv,
    Attached,
}

impl Source {
    fn label(&self) -> &'static str {
        match self {
            Source::DevOverride => "dev override",
            Source::Provisioned => "provisioned (runtime_python)",
            Source::ManagedVenv => "managed venv",
            Source::Attached => "attached to a backend another igni client started",
        }
    }
}

/// Where the interpreter came from: `IGNI_RUNTIME_PYTHON`, then the
/// `runtime_python` setting.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ProvisionReport {
    env: Option<String>,
    setting: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InterpreterReport {
    source: Source,
    active_python: PathBuf,
    venv_python: PathBuf,
    venv_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MarkerReport {
    path: PathBuf,
    contents: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BackendDiagnostics {
    versions: VersionReport,
    interpreter: InterpreterReport,
    provision: ProvisionReport,
    dev: DevOverride,
    marker: MarkerReport,
}

impl BackendDiagnostics {
    /// Probe this machine. Spawns the interpreter, so not on the main thread.
    ///
    /// `attached` is the wire version of a backend another client started,
    /// when the window attached to one. The interpreter is resolved in
    /// `ensure_backend_python`'s order — dev override, provisioned, managed
    /// — so a provisioned runtime is not reported as the managed venv (R620).
    pub fn collect(attached: Option<String>) -> Self {
        let managed = ManagedRuntime::locate_for_display();
        let venv_python = managed.venv_python();
        let marker_path = managed.marker().path().to_path_buf();
        let dev = DevOverride::from_env();
        let provision = ProvisionReport {
            env: std::env::var(RUNTIME_PYTHON_ENV).ok(),
            setting: DesktopSettings::load().runtime_python,
        };
        let provisioned = ProvisionedRuntime::named(
            provision.env.as_deref(),
            &DesktopSettings {
                runtime_python: provision.setting.clone(),
                ..DesktopSettings::default()
            },
        );
        let (source, active_python) = Self::resolve(&dev, provisioned.as_ref(), &venv_python);
        let (source, actual) = match attached {
            Some(wire_version) => (Source::Attached, wire_version),
            None => (
                source,
                runtime::probe_cli_version(&active_python)
                    .unwrap_or_else(|| PROBE_FAILED.to_string()),
            ),
        };
        BackendDiagnostics {
            versions: VersionReport {
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                actual,
            },
            interpreter: InterpreterReport {
                source,
                venv_present: runtime::is_executable(&venv_python),
                active_python,
                venv_python,
            },
            provision,
            dev,
            marker: MarkerReport {
                contents: std::fs::read_to_string(&marker_path)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|_| "<missing>".to_string()),
                path: marker_path,
            },
        }
    }

    /// The interpreter `ensure_backend_python` would start, and why.
    fn resolve(
        dev: &DevOverride,
        provisioned: Option<&ProvisionedRuntime>,
        venv_python: &std::path::Path,
    ) -> (Source, PathBuf) {
        if let Some(path) = dev.override_path() {
            (Source::DevOverride, path)
        } else if let Some(provisioned) = provisioned {
            (Source::Provisioned, provisioned.python().to_path_buf())
        } else {
            (Source::ManagedVenv, venv_python.to_path_buf())
        }
    }

    /// Collect on a background thread and show the report in a dialog.
    pub fn show(app: &AppHandle) {
        let app = app.clone();
        let attached = app
            .try_state::<BackendSupervisor>()
            .and_then(|s| s.current_conn())
            .map(|conn| conn.version().clone())
            .filter(|v| v.source == "discovered")
            .map(|v| v.actual.unwrap_or_else(|| PROBE_FAILED.to_string()));
        std::thread::spawn(move || {
            let report = BackendDiagnostics::collect(attached).to_string();
            app.dialog()
                .message(report)
                .title("igni · Backend Diagnostics")
                .kind(MessageDialogKind::Info)
                .buttons(MessageDialogButtons::Ok)
                .show(|_| {});
        });
    }
}

impl fmt::Display for BackendDiagnostics {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let VersionReport {
            app_version,
            actual,
        } = &self.versions;
        let dev = &self.dev;
        writeln!(f, "igni Tauri app · backend diagnostics")?;
        writeln!(f, "─────────────────────────────────────")?;
        writeln!(f, "App version              : {app_version}")?;
        writeln!(f, "Expected ignite-ember    : {app_version}")?;
        writeln!(f, "Actual ignite-ember      : {actual}")?;
        if actual != app_version && actual != PROBE_FAILED {
            writeln!(f, "                           ↑ MISMATCH — chat may fail")?;
        }
        writeln!(f)?;
        writeln!(
            f,
            "Backend source           : {}",
            self.interpreter.source.label()
        )?;
        writeln!(
            f,
            "Interpreter path         : {}",
            self.interpreter.active_python.display()
        )?;
        writeln!(
            f,
            "Managed venv path        : {}",
            self.interpreter.venv_python.display()
        )?;
        writeln!(
            f,
            "Managed venv present     : {}",
            self.interpreter.venv_present
        )?;
        writeln!(f)?;
        writeln!(
            f,
            "IGNI_RUNTIME_PYTHON      : {}",
            self.provision.env.as_deref().unwrap_or(UNSET)
        )?;
        writeln!(
            f,
            "runtime_python setting   : {}",
            self.provision.setting.as_deref().unwrap_or(UNSET)
        )?;
        writeln!(
            f,
            "IGNI_DEV_BACKEND        : {}",
            dev.dev_backend().unwrap_or(UNSET)
        )?;
        writeln!(
            f,
            "IGNI_PYTHON             : {}",
            dev.igni_python().unwrap_or(UNSET)
        )?;
        writeln!(
            f,
            "IGNITE_EMBER_DEV         : {}",
            dev.ack().unwrap_or(UNSET)
        )?;
        if dev.override_set() && !dev.is_active() {
            writeln!(
                f,
                "                           ↑ override env var set without ack — ignored"
            )?;
        }
        writeln!(f)?;
        writeln!(
            f,
            "Marker file              : {}",
            self.marker.path.display()
        )?;
        writeln!(f, "Marker contents          : {}", self.marker.contents)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev(
        dev_backend: Option<&str>,
        igni_python: Option<&str>,
        dev_ack: Option<&str>,
    ) -> DevOverride {
        DevOverride::new(
            dev_backend.map(str::to_string),
            igni_python.map(str::to_string),
            dev_ack.map(str::to_string),
        )
    }

    fn report(actual: &str, dev: DevOverride) -> String {
        report_with(actual, dev, None)
    }

    fn report_with(actual: &str, dev: DevOverride, setting: Option<&str>) -> String {
        let provisioned = ProvisionedRuntime::named(
            None,
            &DesktopSettings {
                runtime_python: setting.map(str::to_string),
                ..DesktopSettings::default()
            },
        );
        let venv = PathBuf::from("/c/venv/bin/python");
        let (source, active_python) =
            BackendDiagnostics::resolve(&dev, provisioned.as_ref(), &venv);
        BackendDiagnostics {
            versions: VersionReport {
                app_version: "1.0.3".into(),
                actual: actual.into(),
            },
            interpreter: InterpreterReport {
                source,
                active_python,
                venv_python: venv,
                venv_present: true,
            },
            provision: ProvisionReport {
                env: None,
                setting: setting.map(str::to_string),
            },
            dev,
            marker: MarkerReport {
                path: PathBuf::from("/c/igni-install.json"),
                contents: "<missing>".into(),
            },
        }
        .to_string()
    }

    #[test]
    fn the_full_report_reads_as_before() {
        assert_eq!(
            report("1.0.3", dev(None, None, None)),
            "igni Tauri app · backend diagnostics\n\
             ─────────────────────────────────────\n\
             App version              : 1.0.3\n\
             Expected ignite-ember    : 1.0.3\n\
             Actual ignite-ember      : 1.0.3\n\
             \n\
             Backend source           : managed venv\n\
             Interpreter path         : /c/venv/bin/python\n\
             Managed venv path        : /c/venv/bin/python\n\
             Managed venv present     : true\n\
             \n\
             IGNI_RUNTIME_PYTHON      : <unset>\n\
             runtime_python setting   : <unset>\n\
             IGNI_DEV_BACKEND        : <unset>\n\
             IGNI_PYTHON             : <unset>\n\
             IGNITE_EMBER_DEV         : <unset>\n\
             \n\
             Marker file              : /c/igni-install.json\n\
             Marker contents          : <missing>\n"
        );
    }

    #[test]
    fn a_version_mismatch_is_flagged_but_a_failed_probe_is_not() {
        assert!(report("1.0.2", dev(None, None, None)).contains("↑ MISMATCH — chat may fail"));
        assert!(!report(PROBE_FAILED, dev(None, None, None)).contains("MISMATCH"));
    }

    #[test]
    fn an_unacknowledged_override_is_reported_as_ignored() {
        let text = report("1.0.3", dev(Some("/dev/python"), None, None));
        assert!(text.contains("↑ override env var set without ack — ignored"));
        assert!(text.contains("Backend source           : managed venv"));
    }

    #[test]
    fn an_acknowledged_override_is_the_interpreter() {
        let text = report("1.0.3", dev(Some(""), Some("/py/python"), Some("TRUE")));
        assert!(text.contains("Backend source           : dev override"));
        assert!(text.contains("Interpreter path         : /py/python"));
        assert!(!text.contains("ignored"));
    }

    #[test]
    fn a_provisioned_runtime_is_the_interpreter_it_names() {
        let text = report_with(
            "1.0.4",
            dev(None, None, None),
            Some("/home/me/igni-runtime/bin/python"),
        );
        assert!(text.contains("Backend source           : provisioned (runtime_python)"));
        assert!(text.contains("Interpreter path         : /home/me/igni-runtime/bin/python"));
        assert!(text.contains("runtime_python setting   : /home/me/igni-runtime/bin/python"));
    }

    #[test]
    fn an_attached_backend_is_named_as_such() {
        let mut d = BackendDiagnostics {
            versions: VersionReport {
                app_version: "1.0.4".into(),
                actual: "1.0.4".into(),
            },
            interpreter: InterpreterReport {
                source: Source::Attached,
                active_python: PathBuf::from("/c/venv/bin/python"),
                venv_python: PathBuf::from("/c/venv/bin/python"),
                venv_present: true,
            },
            provision: ProvisionReport {
                env: None,
                setting: None,
            },
            dev: dev(None, None, None),
            marker: MarkerReport {
                path: PathBuf::from("/c/igni-install.json"),
                contents: "<missing>".into(),
            },
        };
        assert!(d.to_string().contains(
            "Backend source           : attached to a backend another igni client started"
        ));
        d.interpreter.source = Source::ManagedVenv;
        assert!(d
            .to_string()
            .contains("Backend source           : managed venv"));
    }
}
