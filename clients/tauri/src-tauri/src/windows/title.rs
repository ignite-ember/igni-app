//! Title-bar text: `<folder> · <org>`, Finder's name-only convention.

use std::path::Path;

use tauri::WebviewWindow;

use crate::error::ShellError;

pub(crate) struct WindowTitle;

impl WindowTitle {
    /// Shown when there is no folder name to show.
    pub const FALLBACK: &'static str = "igni";

    /// `folder · org`, the org omitted when blank, the folder falling back
    /// to [`WindowTitle::FALLBACK`].
    pub fn compose(folder: Option<&str>, org: Option<&str>) -> String {
        let folder = folder
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(Self::FALLBACK);
        match org.map(str::trim).filter(|s| !s.is_empty()) {
            Some(org) => format!("{folder} · {org}"),
            None => folder.to_string(),
        }
    }

    /// The basename of `path`.
    pub fn of_path(path: &Path) -> String {
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| Self::FALLBACK.to_string())
    }

    /// The basename of `dir` once resolved, so `.` names its folder.
    pub fn for_dir(dir: &str) -> String {
        Path::new(dir)
            .canonicalize()
            .map(|p| Self::of_path(&p))
            .unwrap_or_else(|_| Self::FALLBACK.to_string())
    }
}

/// Called by the FE on every status update, so the bar follows project
/// and cloud-org changes.
#[tauri::command]
pub(crate) fn set_app_title(
    window: WebviewWindow,
    folder: Option<String>,
    org: Option<String>,
) -> Result<(), ShellError> {
    Ok(window.set_title(&WindowTitle::compose(folder.as_deref(), org.as_deref()))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_and_org_are_joined() {
        assert_eq!(
            WindowTitle::compose(Some("repo"), Some("acme")),
            "repo · acme"
        );
    }

    #[test]
    fn a_blank_org_is_omitted() {
        assert_eq!(WindowTitle::compose(Some(" repo "), Some("  ")), "repo");
        assert_eq!(WindowTitle::compose(Some("repo"), None), "repo");
    }

    #[test]
    fn a_missing_folder_falls_back() {
        assert_eq!(WindowTitle::compose(None, Some("acme")), "igni · acme");
        assert_eq!(WindowTitle::compose(Some(""), None), "igni");
    }

    #[test]
    fn a_path_titles_by_its_basename() {
        assert_eq!(
            WindowTitle::of_path(Path::new("/Users/dev/my repo")),
            "my repo"
        );
        assert_eq!(WindowTitle::of_path(Path::new("/")), "igni");
    }

    #[test]
    fn an_unresolvable_dir_falls_back() {
        assert_eq!(
            WindowTitle::for_dir("/definitely/not/a/real/dir/igni"),
            "igni"
        );
    }
}
