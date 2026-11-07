//! The install marker: a JSON record, in the managed cache, of the
//! component versions installed there.
//!
//! Releases v0.9.5 through v1.0.3 wrote it as ``uv=X;python=Y;ignite=Z``,
//! and before the rename as ``ember-install.json``. Both are still read, so
//! the first launch after an update reinstalls only what changed; the next
//! write replaces them with JSON under the current name.

use std::fs;
use std::path::{Path, PathBuf};

use super::install_plan::ComponentVersions;

const FILE_NAME: &str = "igni-install.json";
/// The marker's name before the rename, read when there is no [`FILE_NAME`].
const LEGACY_FILE_NAME: &str = "ember-install.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InstallMarker {
    path: PathBuf,
}

impl InstallMarker {
    pub fn in_dir(root: &Path) -> Self {
        InstallMarker {
            path: root.join(FILE_NAME),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// What the marker records. A missing or unreadable marker records
    /// nothing, which redoes every component.
    pub(super) fn read(&self) -> ComponentVersions {
        fs::read_to_string(&self.path)
            .or_else(|_| fs::read_to_string(self.path.with_file_name(LEGACY_FILE_NAME)))
            .map(|s| parse(&s))
            .unwrap_or_default()
    }

    pub(super) fn write(&self, versions: &ComponentVersions) -> Result<(), String> {
        let json =
            serde_json::to_string(versions).map_err(|e| format!("encode install marker: {e}"))?;
        fs::write(&self.path, json).map_err(|e| format!("write install marker: {e}"))
    }
}

/// JSON, or else the ``uv=X;python=Y;ignite=Z`` string older releases wrote.
fn parse(contents: &str) -> ComponentVersions {
    serde_json::from_str(contents).unwrap_or_else(|_| parse_fields(contents))
}

/// The pre-JSON format, field by field. A field that is missing or
/// unreadable is ``None``, which redoes that component.
fn parse_fields(contents: &str) -> ComponentVersions {
    let mut versions = ComponentVersions::default();
    for (key, value) in contents.trim().split(';').filter_map(|p| p.split_once('=')) {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let slot = match key.trim() {
            "uv" => &mut versions.uv,
            "python" => &mut versions.python,
            "ignite" => &mut versions.ignite,
            _ => continue,
        };
        *slot = Some(value.to_string());
    }
    versions
}

#[cfg(test)]
mod tests {
    use super::super::install_plan::{InstallPlan, InstalledState};
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("igni_marker_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_marker_round_trips_as_json() {
        let dir = scratch("round_trip");
        let marker = InstallMarker::in_dir(&dir);
        let want = ComponentVersions::of("0.5.7", "3.12", "1.0.3");
        marker.write(&want).unwrap();
        assert_eq!(
            fs::read_to_string(marker.path()).unwrap(),
            r#"{"uv":"0.5.7","python":"3.12","ignite":"1.0.3"}"#
        );
        assert_eq!(marker.read(), want);
        // A venv rebuilt but not yet given igni records no ignite.
        let partial = ComponentVersions {
            ignite: None,
            ..want
        };
        marker.write(&partial).unwrap();
        assert_eq!(marker.read(), partial);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_or_unreadable_marker_records_nothing() {
        let dir = scratch("unreadable");
        let marker = InstallMarker::in_dir(&dir);
        assert_eq!(marker.read(), ComponentVersions::default());
        fs::write(marker.path(), "not a marker").unwrap();
        assert_eq!(marker.read(), ComponentVersions::default());
        fs::write(marker.path(), r#"{"uv":"0.5.7"}"#).unwrap();
        assert_eq!(
            marker.read().uv.as_deref(),
            Some("0.5.7"),
            "a missing field is unknown"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_old_single_string_marker_plans_only_the_igni_install() {
        let dir = scratch("old_format");
        let marker = InstallMarker::in_dir(&dir);
        // What v0.9.5 through v1.0.3 wrote, byte for byte.
        fs::write(marker.path(), "uv=0.5.7;python=3.12;ignite=1.0.2").unwrap();
        let recorded = marker.read();
        assert_eq!(recorded, ComponentVersions::of("0.5.7", "3.12", "1.0.2"));
        let have = InstalledState {
            recorded,
            uv_present: true,
            venv_present: true,
            venv_reports: Some("1.0.2".to_string()),
        };
        let plan = InstallPlan::new(&have, &ComponentVersions::of("0.5.7", "3.12", "1.0.3"));
        assert!(plan.install_ignite && !plan.fetch_uv && !plan.rebuild_venv);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_garbled_old_marker_field_counts_as_unknown() {
        let m = parse("uv=0.5.7;python=;nonsense;ignite=1.0.3\n");
        assert_eq!(m.uv.as_deref(), Some("0.5.7"));
        assert_eq!(m.python, None);
        assert_eq!(m.ignite.as_deref(), Some("1.0.3"));
        assert_eq!(parse(""), ComponentVersions::default());
    }

    #[test]
    fn the_marker_from_before_the_rename_is_read_until_the_new_one_is_written() {
        let dir = scratch("legacy_name");
        let marker = InstallMarker::in_dir(&dir);
        fs::write(
            dir.join(LEGACY_FILE_NAME),
            "uv=0.5.7;python=3.12;ignite=1.0.3",
        )
        .unwrap();
        assert_eq!(marker.read().ignite.as_deref(), Some("1.0.3"));
        marker
            .write(&ComponentVersions::of("0.5.7", "3.12", "1.0.4"))
            .unwrap();
        assert_eq!(marker.read().ignite.as_deref(), Some("1.0.4"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
