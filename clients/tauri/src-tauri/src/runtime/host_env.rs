//! The environment a Python the shell starts gets: the user's, not the
//! AppImage's.
//!
//! An AppImage's `AppRun` points `PYTHONHOME`, `PYTHONPATH` and
//! `LD_LIBRARY_PATH` into its own mount (`$APPDIR`) and puts the mount's
//! `bin` first on `PATH`, for the programs inside the image. Every child
//! inherits them, so the managed venv's, the provisioned and uv's own
//! CPython came up with the mount's standard library and libraries: the
//! provisioned runtime "cannot import igni_core", the managed venv died
//! before signalling ready, and `prefetch_models` failed (R613).
//!
//! Under an AppImage every entry inside `$APPDIR` is taken out of those
//! variables, and a variable left empty is removed. Anywhere else nothing
//! changes: a `PYTHONPATH` the person set is theirs.

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::Command;

/// The variables `AppRun` points into the mount that change what a
/// Python, or what it runs, loads.
const MOUNT_PATHS: [&str; 4] = ["PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH", "PATH"];

/// `program`, to be started with the user's environment rather than the
/// AppImage's. Every interpreter and uv the shell starts goes through here.
pub(crate) fn host_command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    if std::env::var_os("APPIMAGE").is_some() {
        if let Some(appdir) = std::env::var_os("APPDIR") {
            scrub(&mut cmd, Path::new(&appdir), |key| std::env::var_os(key));
        }
    }
    cmd
}

/// Take `appdir`'s entries out of [`MOUNT_PATHS`] as `read` reports them.
fn scrub(cmd: &mut Command, appdir: &Path, read: impl Fn(&str) -> Option<OsString>) {
    for key in MOUNT_PATHS {
        let Some(value) = read(key) else { continue };
        match outside(&value, appdir) {
            Some(kept) if kept == value => {}
            Some(kept) => {
                cmd.env(key, kept);
            }
            None => {
                cmd.env_remove(key);
            }
        }
    }
}

/// `value`'s path entries that are not inside `appdir`, or `None` when
/// none is left.
fn outside(value: &OsStr, appdir: &Path) -> Option<OsString> {
    let kept: Vec<_> = std::env::split_paths(value)
        .filter(|entry| !entry.as_os_str().is_empty() && !entry.starts_with(appdir))
        .collect();
    if kept.is_empty() {
        return None;
    }
    std::env::join_paths(kept).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const MOUNT: &str = "/tmp/.mount_igni_1NGooMI";

    fn envs(cmd: &Command) -> HashMap<String, Option<String>> {
        cmd.get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect()
    }

    #[test]
    fn the_mounts_python_variables_do_not_reach_a_child() {
        // The values seen in /proc/<igni-app pid>/environ under the AppImage.
        let apprun: HashMap<&str, String> = HashMap::from([
            ("PYTHONHOME", format!("{MOUNT}/usr/")),
            ("PYTHONPATH", format!("{MOUNT}/usr/share/pyshared/:")),
            (
                "LD_LIBRARY_PATH",
                format!("{MOUNT}/usr/lib/:{MOUNT}/usr/lib/x86_64-linux-gnu/:/opt/cuda/lib64"),
            ),
            ("PATH", format!("{MOUNT}/usr/bin/:/usr/local/bin:/usr/bin")),
        ]);
        let mut cmd = Command::new("python");
        scrub(&mut cmd, Path::new(MOUNT), |k| {
            apprun.get(k).map(OsString::from)
        });
        let set = envs(&cmd);
        assert_eq!(set["PYTHONHOME"], None);
        assert_eq!(set["PYTHONPATH"], None);
        assert_eq!(set["LD_LIBRARY_PATH"].as_deref(), Some("/opt/cuda/lib64"));
        assert_eq!(set["PATH"].as_deref(), Some("/usr/local/bin:/usr/bin"));
    }

    #[test]
    fn variables_with_nothing_from_the_mount_are_left_alone() {
        let mut cmd = Command::new("python");
        scrub(&mut cmd, Path::new(MOUNT), |k| match k {
            "PYTHONPATH" => Some("/home/me/lib".into()),
            "PATH" => Some("/usr/bin".into()),
            _ => None,
        });
        assert!(envs(&cmd).is_empty(), "{:?}", envs(&cmd));
    }

    #[test]
    fn outside_an_appimage_nothing_is_touched() {
        // `cargo test` runs without APPIMAGE set.
        assert!(std::env::var_os("APPIMAGE").is_none());
        assert!(envs(&host_command("python")).is_empty());
    }
}
