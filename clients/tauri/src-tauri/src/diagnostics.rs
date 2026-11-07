//! File › Diagnose Backend: a one-click triage report for bug reports.

use std::fmt;
use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::runtime::{self, DevOverride, ManagedRuntime};

/// The marker shows its own placeholder when the probe fails.
const PROBE_FAILED: &str = "<probe failed>";
const UNSET: &str = "<unset>";

#[derive(Debug, Clone, PartialEq, Eq)]
struct VersionReport {
    app_version: String,
    actual: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InterpreterReport {
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
    dev: DevOverride,
    marker: MarkerReport,
}

impl BackendDiagnostics {
    /// Probe this machine. Spawns the interpreter, so not on the main thread.
    pub fn collect() -> Self {
        let managed = ManagedRuntime::locate_for_display();
        let venv_python = managed.venv_python();
        let marker_path = managed.marker().path().to_path_buf();
        let dev = DevOverride::from_env();
        let active_python = dev.override_path().unwrap_or_else(|| venv_python.clone());
        BackendDiagnostics {
            versions: VersionReport {
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                actual: runtime::probe_cli_version(&active_python)
                    .unwrap_or_else(|| PROBE_FAILED.to_string()),
            },
            interpreter: InterpreterReport {
                venv_present: runtime::is_executable(&venv_python),
                active_python,
                venv_python,
            },
            dev,
            marker: MarkerReport {
                contents: std::fs::read_to_string(&marker_path)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|_| "<missing>".to_string()),
                path: marker_path,
            },
        }
    }

    /// Collect on a background thread and show the report in a dialog.
    pub fn show(app: &AppHandle) {
        let app = app.clone();
        std::thread::spawn(move || {
            let report = BackendDiagnostics::collect().to_string();
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
        let source = if dev.override_path().is_some() {
            "dev override"
        } else {
            "managed venv"
        };
        writeln!(f, "Backend source           : {source}")?;
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
        BackendDiagnostics {
            versions: VersionReport {
                app_version: "1.0.3".into(),
                actual: actual.into(),
            },
            interpreter: InterpreterReport {
                active_python: dev
                    .override_path()
                    .unwrap_or_else(|| PathBuf::from("/c/venv/bin/python")),
                venv_python: PathBuf::from("/c/venv/bin/python"),
                venv_present: true,
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
}
