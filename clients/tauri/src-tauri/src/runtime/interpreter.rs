//! Questions asked of a Python interpreter on disk.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

/// Whether `path` is a file that could be run. A directory or a missing
/// path is not.
pub(crate) fn is_executable(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

/// ``igni_core.__version__`` as reported by the given interpreter, or
/// ``None`` on any failure. A cold ``import igni_core`` costs 30-80ms.
pub(crate) fn probe_cli_version(python: &Path) -> Option<String> {
    if !is_executable(python) {
        return None;
    }
    let output = Command::new(python)
        .args([
            "-c",
            "import igni_core, sys; sys.stdout.write(igni_core.__version__)",
        ])
        // A Python-side import error stays off the parent's console; only
        // stdout on a successful exit matters.
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!out.is_empty()).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_executable_detects_real_file() {
        let tmp = std::env::temp_dir().join(format!("igni_runtime_test_{}", std::process::id()));
        fs::write(&tmp, b"hi").unwrap();
        assert!(is_executable(&tmp));
        assert!(!is_executable(&std::env::temp_dir()), "a directory is not");
        assert!(
            !is_executable(&tmp.with_extension("nope")),
            "a missing path is not"
        );
        fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn a_missing_interpreter_reports_no_version() {
        assert_eq!(probe_cli_version(Path::new("/nonexistent/python")), None);
    }
}
