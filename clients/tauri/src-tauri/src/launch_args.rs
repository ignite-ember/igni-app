//! What the app was launched with, read once in `run()`.

use std::path::{Path, PathBuf};

/// The environment variable naming the project folder.
const PROJECT_DIR_ENV: &str = "IGNI_PROJECT_DIR";
/// Wipes the managed runtime before bootstrap, for a user who cannot
/// reach the File menu.
const REINSTALL_FLAG: &str = "--reinstall";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LaunchArgs {
    project_dir: String,
    reinstall: bool,
}

impl LaunchArgs {
    pub fn from_process() -> Self {
        let args: Vec<String> = std::env::args().skip(1).collect();
        Self::resolve(
            &args,
            std::env::var(PROJECT_DIR_ENV).ok(),
            std::env::current_dir().ok(),
        )
    }

    /// The project folder, first signal wins: a positional argument, the
    /// environment variable, a `.git` above `cwd` (`cargo tauri dev` runs
    /// from `src-tauri/`), then `~/Documents`, home, and `.`.
    pub fn resolve(args: &[String], env_dir: Option<String>, cwd: Option<PathBuf>) -> Self {
        let project_dir = args
            .iter()
            .find(|a| !a.starts_with("--"))
            .cloned()
            .or_else(|| {
                env_dir
                    .map(|d| d.trim().to_string())
                    .filter(|d| !d.is_empty())
            })
            .or_else(|| cwd.as_deref().and_then(Self::enclosing_repo))
            .unwrap_or_else(Self::fallback_dir);
        LaunchArgs {
            project_dir,
            reinstall: args.iter().any(|a| a == REINSTALL_FLAG),
        }
    }

    fn enclosing_repo(cwd: &Path) -> Option<String> {
        cwd.ancestors()
            .find(|dir| dir.join(".git").exists())
            .map(|dir| dir.to_string_lossy().into_owned())
    }

    /// `~/Documents`, created if missing, so a Dock launch lands somewhere
    /// writable rather than `/`.
    fn fallback_dir() -> String {
        if let Some(docs) = dirs::document_dir() {
            if let Err(e) = std::fs::create_dir_all(&docs) {
                eprintln!("igni: could not create {}: {e}", docs.display());
            }
            return docs.to_string_lossy().into_owned();
        }
        dirs::home_dir()
            .map(|home| home.to_string_lossy().into_owned())
            .unwrap_or_else(|| ".".to_string())
    }

    pub fn project_dir(&self) -> &str {
        &self.project_dir
    }

    pub fn reinstall(&self) -> bool {
        self.reinstall
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn scratch_repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("igni_launch_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        root
    }

    #[test]
    fn a_positional_argument_wins() {
        let got = LaunchArgs::resolve(
            &args(&["--reinstall", "/work/repo"]),
            Some("/env".into()),
            None,
        );
        assert_eq!(got.project_dir(), "/work/repo");
        assert!(got.reinstall());
    }

    #[test]
    fn the_environment_variable_comes_next_trimmed() {
        let got = LaunchArgs::resolve(&args(&["--flag"]), Some("  /env/repo \n".into()), None);
        assert_eq!(got.project_dir(), "/env/repo");
        assert!(!got.reinstall());
    }

    #[test]
    fn a_blank_environment_variable_is_ignored() {
        let root = scratch_repo("blank_env");
        let got = LaunchArgs::resolve(&[], Some("   ".into()), Some(root.join("a/b")));
        assert_eq!(got.project_dir(), root.to_string_lossy());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_enclosing_repository_is_found_from_a_subfolder() {
        let root = scratch_repo("walk_up");
        let got = LaunchArgs::resolve(&[], None, Some(root.join("a/b")));
        assert_eq!(got.project_dir(), root.to_string_lossy());
        let _ = std::fs::remove_dir_all(&root);
    }
}
