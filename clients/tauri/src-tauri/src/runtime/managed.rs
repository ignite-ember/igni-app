//! The managed runtime: uv, a pinned CPython, a venv with igni-core and the
//! decision model, all under a per-user cache dir (``~/Library/Caches/igni``
//! on macOS, ``$XDG_CACHE_HOME/igni`` on Linux, ``%LOCALAPPDATA%\igni`` on
//! Windows). An install made before the rename keeps its ``ember-code``
//! directory: the venv in it records absolute paths, so moving it would cost
//! a full reinstall.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::update_policy::UpdatePolicy;

use super::install_plan::{ComponentVersions, InstallPlan, InstalledState};
use super::interpreter::{is_executable, probe_cli_version};
use super::marker::InstallMarker;
use super::uv::Uv;
use super::{
    BackendInstall, BackendSource, ProgressFn, IGNI_CORE_VERSION, PYTHON_VERSION,
    RUNTIME_PYTHON_ENV,
};

/// The cache directory's name, and its name before the rename.
const CACHE_DIR: &str = "igni";
const LEGACY_CACHE_DIR: &str = "ember-code";

/// 1 GB. Sized for uv (~25 MB) + CPython (~50 MB) + igni-core +
/// transitives (laya / transformers / torch — ~600 MB unpacked) +
/// headroom. The decision model itself (~1.7 GB) is fetched after. Failing
/// fast here is much kinder than letting pip die mid-install.
const MIN_BOOTSTRAP_FREE_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedRuntime {
    root: PathBuf,
}

impl ManagedRuntime {
    /// The runtime under this user's cache dir.
    pub fn locate() -> Result<Self, String> {
        dirs::cache_dir()
            .map(|d| Self::in_cache_dir(&d))
            .ok_or_else(|| "could not resolve per-user cache dir".to_string())
    }

    /// For display-only callers (the Doctor dialog): a placeholder root
    /// when the OS hands us no cache dir, so the report still renders.
    pub fn locate_for_display() -> Self {
        Self::locate().unwrap_or_else(|_| ManagedRuntime {
            root: PathBuf::from("<cache dir unavailable>"),
        })
    }

    /// ``igni`` under the cache dir, unless an install from before the
    /// rename is there as ``ember-code`` and nothing yet as ``igni``.
    fn in_cache_dir(cache_dir: &Path) -> Self {
        let current = cache_dir.join(CACHE_DIR);
        let legacy = cache_dir.join(LEGACY_CACHE_DIR);
        let root = if !current.exists() && legacy.exists() {
            legacy
        } else {
            current
        };
        ManagedRuntime { root }
    }

    pub fn venv_python(&self) -> PathBuf {
        let rel = if cfg!(target_os = "windows") {
            "Scripts/python.exe"
        } else {
            "bin/python"
        };
        self.venv_dir().join(rel)
    }

    pub fn marker(&self) -> InstallMarker {
        InstallMarker::in_dir(&self.root)
    }

    fn venv_dir(&self) -> PathBuf {
        self.root.join("venv")
    }

    /// Beside the venv, not in it: neither an igni upgrade nor a Python bump
    /// wipes the decision model.
    fn hf_home(&self) -> PathBuf {
        self.root.join("huggingface")
    }

    fn uv(&self) -> Uv {
        Uv::in_dir(&self.root)
    }

    /// Wipe the cache so the next bootstrap re-downloads everything. Wired
    /// to the "Reinstall Backend (Clean)" menu item.
    pub fn reset(&self) -> Result<(), String> {
        if self.root.exists() {
            fs::remove_dir_all(&self.root)
                .map_err(|e| format!("wipe cache {}: {}", self.root.display(), e))?;
        }
        Ok(())
    }

    /// Bring the runtime up to this build's versions and return its install.
    pub fn ensure(&self, progress: ProgressFn, expected: String) -> Result<BackendInstall, String> {
        fs::create_dir_all(&self.root).map_err(|e| format!("create cache dir: {e}"))?;
        self.ensure_free_space(MIN_BOOTSTRAP_FREE_BYTES)?;

        let want = ComponentVersions::current();
        let have = self.inspect();
        let plan = InstallPlan::new(&have, &want);
        if plan.venv_version_mismatch {
            eprintln!(
                "Managed venv marker says ignite={} but the interpreter reports {} — reinstalling igni-core.",
                have.recorded.ignite.as_deref().unwrap_or("<none>"),
                have.venv_reports.as_deref().unwrap_or("<probe failed>")
            );
        }
        if plan.any() && UpdatePolicy::load().air_gapped() {
            return Err(self.air_gapped_refusal());
        }
        self.apply(&plan, have.recorded, &want, progress)?;

        // Probe the just-reinstalled venv so the install carries the
        // confirmed version.
        let actual = if plan.install_ignite {
            probe_cli_version(&self.venv_python())
        } else {
            have.venv_reports
        };
        Ok(BackendInstall {
            python: self.venv_python(),
            env: vec![(
                "HF_HOME".to_string(),
                self.hf_home().to_string_lossy().into_owned(),
            )],
            actual_cli_version: actual,
            expected_cli_version: expected,
            source: BackendSource::ManagedVenv,
        })
    }

    /// What the cache holds. The venv's interpreter is probed to catch a
    /// marker that disagrees with the wheels on disk (a manual pip upgrade,
    /// a half-finished install).
    fn inspect(&self) -> InstalledState {
        let venv_present = is_executable(&self.venv_python());
        InstalledState {
            recorded: self.marker().read(),
            uv_present: self.uv().is_present(),
            venv_present,
            venv_reports: venv_present
                .then(|| probe_cli_version(&self.venv_python()))
                .flatten(),
        }
    }

    /// An air-gapped install has no route to github.com (uv), the Python
    /// builds uv fetches, PyPI or Hugging Face, so it does not try: the
    /// runtime has to be provisioned by whoever installs the app. Said
    /// plainly rather than left to four timeouts.
    fn air_gapped_refusal(&self) -> String {
        format!(
            "igni is air-gapped (air_gapped: true), so the desktop app will not download its Python \
             runtime. Install igni-core[decisions]=={IGNI_CORE_VERSION} from your package mirror \
             into a Python {PYTHON_VERSION} interpreter and set runtime_python in \
             ~/.igni/config.yaml or managed settings (or {RUNTIME_PYTHON_ENV}) to its path, then \
             start the app again. (Cache directory for a managed install: {}.)",
            self.root.display()
        )
    }

    /// Carry out the plan. The marker is rewritten after each step that
    /// succeeds, so a bootstrap that fails half-way redoes only what it did
    /// not finish.
    fn apply(
        &self,
        plan: &InstallPlan,
        mut have: ComponentVersions,
        want: &ComponentVersions,
        progress: ProgressFn,
    ) -> Result<(), String> {
        let marker = self.marker();
        if plan.fetch_uv {
            progress("Downloading uv (one-time, ~25 MB)…");
            self.uv().fetch().map_err(|e| format!("download uv: {e}"))?;
            have.uv = want.uv.clone();
            marker.write(&have)?;
        }
        if plan.rebuild_venv {
            self.rebuild_venv(progress)?;
            have.python = want.python.clone();
            // A fresh venv has no igni-core in it.
            have.ignite = None;
            marker.write(&have)?;
        }
        if plan.install_ignite {
            self.install_ignite(plan.rebuild_venv, progress)?;
            self.prefetch_model(progress)?;
            have.ignite = want.ignite.clone();
            marker.write(&have)?;
        }
        Ok(())
    }

    /// The venv is tied to its Python, so a Python bump (or a missing venv)
    /// wipes and recreates it.
    fn rebuild_venv(&self, progress: ProgressFn) -> Result<(), String> {
        let venv_dir = self.venv_dir();
        if venv_dir.exists() {
            progress("Refreshing managed venv…");
            fs::remove_dir_all(&venv_dir).map_err(|e| format!("clean venv: {e}"))?;
        }
        let uv = self.uv();
        progress(&format!("Installing Python {PYTHON_VERSION} (one-time)…"));
        uv.run(&["python", "install", PYTHON_VERSION])?;
        progress("Creating backend venv…");
        uv.run(&[
            "venv",
            "--python",
            PYTHON_VERSION,
            venv_dir.to_string_lossy().as_ref(),
        ])
    }

    /// `uv pip install igni-core==X` upgrades (or downgrades) in place.
    fn install_ignite(&self, fresh_venv: bool, progress: ProgressFn) -> Result<(), String> {
        progress(if fresh_venv {
            "Installing igni-core (one-time)…"
        } else {
            "Updating igni-core…"
        });
        self.uv().run(&[
            "pip",
            "install",
            "--python",
            self.venv_python().to_string_lossy().as_ref(),
            // ``decisions``: igni's decisions service (Laya), which the
            // backend starts beside itself on first use.
            &format!("igni-core[decisions]=={IGNI_CORE_VERSION}"),
        ])
    }

    /// Pre-warm the decision model so the first Bypass check or
    /// `host.decide` doesn't stall on a silent HuggingFace download. Re-run
    /// on every package install, since a release can change the model; with
    /// the model already in `HF_HOME` it only loads it.
    fn prefetch_model(&self, progress: ProgressFn) -> Result<(), String> {
        progress("Checking igni's decision model (~1.7 GB on first install)…");
        let status = Command::new(self.venv_python())
            .args(["-m", "igni_core.prefetch_models"])
            .env("HF_HOME", self.hf_home())
            .status()
            .map_err(|e| format!("spawn prefetch_models: {e}"))?;
        if !status.success() {
            return Err(format!("prefetch_models exited with status {status}"));
        }
        Ok(())
    }

    /// Fail fast when the closest existing ancestor of the cache has less
    /// than `min_bytes` free.
    fn ensure_free_space(&self, min_bytes: u64) -> Result<(), String> {
        let Some(probe) = self.root.ancestors().find(|p| p.exists()) else {
            return Ok(());
        };
        let free =
            fs2::available_space(probe).map_err(|e| format!("disk-space check failed: {e}"))?;
        if free >= min_bytes {
            return Ok(());
        }
        let free_mb = free / (1024 * 1024);
        let need_mb = min_bytes / (1024 * 1024);
        Err(format!(
            "Not enough disk space for the Ember backend bootstrap: \
             {free_mb} MB free at {}, need at least {need_mb} MB. \
             Free up space and try again.",
            self.root.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(root: PathBuf) -> ManagedRuntime {
        ManagedRuntime { root }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("igni_runtime_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn free_space_accepts_zero_requirement() {
        assert!(at(std::env::temp_dir()).ensure_free_space(0).is_ok());
    }

    #[test]
    fn free_space_rejects_impossibly_large_requirement() {
        let petabyte: u64 = 1024 * 1024 * 1024 * 1024 * 1024;
        let err = at(std::env::temp_dir())
            .ensure_free_space(petabyte)
            .unwrap_err();
        assert!(err.contains("Not enough disk space"));
        assert!(err.contains("MB free"));
        assert!(err.contains("need at least"));
    }

    #[test]
    fn free_space_walks_up_to_existing_parent() {
        let nonexistent = std::env::temp_dir()
            .join("igni_runtime_test_does_not_exist")
            .join("nested")
            .join("further");
        assert!(at(nonexistent).ensure_free_space(0).is_ok());
    }

    #[test]
    fn the_venv_python_matches_platform_layout() {
        let rt = at(PathBuf::from("/c"));
        let rel = if cfg!(target_os = "windows") {
            "venv/Scripts/python.exe"
        } else {
            "venv/bin/python"
        };
        assert_eq!(rt.venv_python(), Path::new("/c").join(rel));
    }

    #[test]
    fn the_decision_model_cache_is_outside_the_venv() {
        // A venv rebuild wipes `venv/`; the model lives in `huggingface/`
        // beside it, so neither an igni upgrade nor a Python bump wipes it.
        let rt = at(PathBuf::from("/c"));
        assert!(!rt.hf_home().starts_with(rt.venv_dir()));
        let src = include_str!("managed.rs");
        let rebuild = src
            .split("fn rebuild_venv")
            .nth(1)
            .unwrap()
            .split("\n    }\n")
            .next()
            .unwrap();
        assert_eq!(
            rebuild.matches("remove_dir_all").count(),
            1,
            "only the venv is removed"
        );
        assert!(rebuild.contains("remove_dir_all(&venv_dir)"));
    }

    #[test]
    fn a_fresh_install_caches_under_igni() {
        let caches = scratch("fresh_cache");
        assert_eq!(
            ManagedRuntime::in_cache_dir(&caches),
            at(caches.join("igni"))
        );
        fs::remove_dir_all(&caches).unwrap();
    }

    #[test]
    fn an_install_from_before_the_rename_keeps_its_cache_where_it_is() {
        // Its venv records absolute paths: moving it would mean reinstalling.
        let caches = scratch("legacy_cache");
        fs::create_dir_all(caches.join("ember-code")).unwrap();
        assert_eq!(
            ManagedRuntime::in_cache_dir(&caches),
            at(caches.join("ember-code"))
        );
        fs::create_dir_all(caches.join("igni")).unwrap();
        assert_eq!(
            ManagedRuntime::in_cache_dir(&caches),
            at(caches.join("igni"))
        );
        fs::remove_dir_all(&caches).unwrap();
    }

    #[test]
    fn reset_wipes_the_cache() {
        let rt = at(scratch("reset"));
        fs::write(rt.root.join("uv"), b"").unwrap();
        rt.reset().unwrap();
        assert!(!rt.root.exists());
        rt.reset().expect("an absent cache is already reset");
    }
}
