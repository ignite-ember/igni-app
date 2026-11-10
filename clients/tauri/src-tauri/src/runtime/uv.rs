//! The ``uv`` binary the managed runtime installs Python and igni-core with:
//! fetching it from its GitHub release and running it.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[cfg(not(target_os = "windows"))]
use std::os::unix::fs::PermissionsExt;

use crate::error::LogOnError;

use super::interpreter::is_executable;
use super::UV_VERSION;

const ARCHIVE_EXT: &str = if cfg!(target_os = "windows") {
    "zip"
} else {
    "tar.gz"
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Uv {
    path: PathBuf,
}

impl Uv {
    pub fn in_dir(root: &Path) -> Self {
        Uv {
            path: root.join(Self::bin_name()),
        }
    }

    pub fn is_present(&self) -> bool {
        is_executable(&self.path)
    }

    fn bin_name() -> &'static str {
        if cfg!(target_os = "windows") {
            "uv.exe"
        } else {
            "uv"
        }
    }

    /// The running OS/arch as the uv GitHub-release asset names it.
    fn target() -> Result<&'static str, String> {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => Ok("aarch64-apple-darwin"),
            ("linux", "aarch64") => Ok("aarch64-unknown-linux-gnu"),
            ("linux", "x86_64") => Ok("x86_64-unknown-linux-gnu"),
            ("windows", "x86_64") => Ok("x86_64-pc-windows-msvc"),
            (os, arch) => Err(format!("unsupported platform: {os}/{arch}")),
        }
    }

    /// Download the pinned release and put its binary at this path.
    pub fn fetch(&self) -> Result<(), String> {
        let triple = Self::target()?;
        let url = format!(
            "https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-{triple}.{ARCHIVE_EXT}"
        );
        // ureq follows redirects by default — GitHub release URLs redirect
        // once to a signed S3 URL.
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(120))
            .build();
        let resp = agent
            .get(&url)
            .call()
            .map_err(|e| format!("HTTP error fetching uv: {e}"))?;
        if resp.status() < 200 || resp.status() >= 300 {
            return Err(format!(
                "uv download returned HTTP {} from {url}",
                resp.status()
            ));
        }
        let archive =
            std::env::temp_dir().join(format!("uv-download-{}.{ARCHIVE_EXT}", std::process::id()));
        let mut bytes = Vec::new();
        resp.into_reader()
            .read_to_end(&mut bytes)
            .map_err(|e| format!("read uv body: {e}"))?;
        fs::write(&archive, &bytes).map_err(|e| format!("write uv tmp: {e}"))?;

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create dest dir: {e}"))?;
        }
        let extracted = self.extract(&archive);
        fs::remove_file(&archive).log_on_error("removing the downloaded uv archive");
        extracted
    }

    #[cfg(not(target_os = "windows"))]
    fn extract(&self, archive: &Path) -> Result<(), String> {
        let file = fs::File::open(archive).map_err(|e| format!("open archive: {e}"))?;
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
        let extract_dir = std::env::temp_dir().join(format!("uv-extract-{}", std::process::id()));
        fs::create_dir_all(&extract_dir).map_err(|e| format!("mkdir extract: {e}"))?;
        let installed = tar
            .unpack(&extract_dir)
            .map_err(|e| format!("untar: {e}"))
            .and_then(|()| self.install_from(&extract_dir));
        fs::remove_dir_all(&extract_dir).log_on_error("removing the extracted uv archive");
        installed
    }

    /// Move the ``uv`` binary out of an unpacked release (``uv-<triple>/uv``)
    /// and make it executable.
    #[cfg(not(target_os = "windows"))]
    fn install_from(&self, extract_dir: &Path) -> Result<(), String> {
        let src = Self::find_named(extract_dir, "uv")
            .ok_or_else(|| "uv binary not found in extracted archive".to_string())?;
        fs::rename(&src, &self.path)
            .or_else(|_| fs::copy(&src, &self.path).map(|_| ()))
            .map_err(|e| format!("move uv to {}: {}", self.path.display(), e))?;
        fs::set_permissions(&self.path, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("chmod uv: {e}"))
    }

    #[cfg(target_os = "windows")]
    fn extract(&self, archive: &Path) -> Result<(), String> {
        let file = fs::File::open(archive).map_err(|e| format!("open archive: {e}"))?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("open zip: {e}"))?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| format!("zip entry: {e}"))?;
            if entry.is_file() && entry.name().ends_with("uv.exe") {
                let mut out =
                    fs::File::create(&self.path).map_err(|e| format!("create dest: {e}"))?;
                std::io::copy(&mut entry, &mut out).map_err(|e| format!("copy uv.exe: {e}"))?;
                return Ok(());
            }
        }
        Err("uv.exe not found in archive".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    fn find_named(root: &Path, name: &str) -> Option<PathBuf> {
        for entry in fs::read_dir(root).ok()?.flatten() {
            let path = entry.path();
            if path.file_name().is_some_and(|n| n == name) && path.is_file() {
                return Some(path);
            }
            if path.is_dir() {
                if let Some(found) = Self::find_named(&path, name) {
                    return Some(found);
                }
            }
        }
        None
    }

    pub fn run(&self, args: &[&str]) -> Result<(), String> {
        let status = Command::new(&self.path)
            .args(args)
            .status()
            .map_err(|e| format!("spawn uv: {e}"))?;
        if !status.success() {
            return Err(format!(
                "uv {} exited with status {}",
                args.join(" "),
                status
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_target_is_a_known_triple_on_this_platform() {
        // The exhaustive match is the contract; this catches a regression
        // that removes the current host's arm.
        let triple = Uv::target().expect("host platform must be mapped");
        let known = [
            "aarch64-apple-darwin",
            "aarch64-unknown-linux-gnu",
            "x86_64-unknown-linux-gnu",
            "x86_64-pc-windows-msvc",
        ];
        assert!(known.contains(&triple), "unexpected triple {triple:?}");
    }

    #[test]
    fn the_binary_has_the_platform_name() {
        let uv = Uv::in_dir(Path::new("/c"));
        let expected = if cfg!(target_os = "windows") {
            "uv.exe"
        } else {
            "uv"
        };
        assert_eq!(uv.path, Path::new("/c").join(expected));
    }
}
