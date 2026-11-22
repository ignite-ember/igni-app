//! The ``uv`` binary the managed runtime installs Python and igni-core with:
//! fetching it from its GitHub release and running it.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(not(target_os = "windows"))]
use std::os::unix::fs::PermissionsExt;

use crate::error::{CauseChain, LogOnError};

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

    /// Where the binary is (or would be).
    pub fn path(&self) -> &Path {
        &self.path
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

    /// GET `url` and its body, through the shell's one agent (`net`):
    /// the system's certificate roots, so a proxy that inspects TLS with a
    /// company CA works once IT has installed that CA, and the
    /// environment's `HTTPS_PROXY`/`NO_PROXY`. ureq follows redirects by
    /// default; GitHub release URLs redirect once to a signed S3 URL.
    fn download(url: &str) -> Result<Vec<u8>, String> {
        let host = tauri::Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_default();
        let agent = crate::cloud::net::agent_builder(&host, true)
            .map_err(|e| format!("the system's certificate roots are unavailable ({e})"))?
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(120))
            .build();
        let resp = agent
            .get(url)
            .call()
            .map_err(|e| CauseChain::new(&e, CauseChain::DOWNLOAD).to_string())?;
        if resp.status() < 200 || resp.status() >= 300 {
            return Err(format!("uv download returned HTTP {} from {url}", resp.status()));
        }
        let mut bytes = Vec::new();
        resp.into_reader()
            .read_to_end(&mut bytes)
            .map_err(|e| format!("read uv body: {e}"))?;
        Ok(bytes)
    }

    /// Download the pinned release and put its binary at this path.
    pub fn fetch(&self) -> Result<(), String> {
        let triple = Self::target()?;
        let url = format!(
            "https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-{triple}.{ARCHIVE_EXT}"
        );
        let bytes = Self::download(&url)?;
        let archive =
            std::env::temp_dir().join(format!("uv-download-{}.{ARCHIVE_EXT}", std::process::id()));
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
            // zip 9 hands the name back as a Result, so a name that cannot be
            // read is simply not the file being looked for.
            if entry.is_file() && entry.name().is_ok_and(|n| n.ends_with("uv.exe")) {
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
        let status = super::host_command(&self.path)
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

/// Copy ``uv.exe`` out of uv's Windows release zip to ``dest``.
///
/// zip 9 made an entry's ``name()`` fallible (a name that is not valid
/// UTF-8 is an error, not a lossy string). The call site still read it as
/// a string, which no CI job compiled — only the Windows build, and only a
/// release ran that — so the Windows app did not build at all. Compiled
/// for tests everywhere, so the Linux test job holds this now.
#[cfg(any(target_os = "windows", test))]
fn extract_uv_exe(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| format!("open archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("open zip: {e}"))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("zip entry: {e}"))?;
        // An entry whose name is not UTF-8 is not uv.exe.
        let is_uv = entry.is_file() && entry.name().is_ok_and(|n| n.ends_with("uv.exe"));
        if is_uv {
            let mut out = fs::File::create(dest).map_err(|e| format!("create dest: {e}"))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("copy uv.exe: {e}"))?;
            return Ok(());
        }
    }
    Err("uv.exe not found in archive".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tls_testing::TestMirror;

    #[test]
    fn a_download_whose_certificate_this_computer_does_not_trust_is_refused_and_says_why() {
        // What a proxy that inspects TLS looks like before IT installs its
        // CA: a certificate for the host from an authority in no store.
        let mirror = TestMirror::start("uv");
        let url = mirror.url("/uv.tar.gz");
        let message = Uv::download(&url).unwrap_err();
        assert!(message.contains(&url), "{message}");
        assert!(message.contains("invalid peer certificate"), "{message}");
        // macOS refuses this 100-year leaf for its lifetime before its
        // issuer; the advice follows the issuer verdict.
        #[cfg(not(target_os = "macos"))]
        assert!(message.ends_with(CauseChain::DOWNLOAD), "{message}");
    }

    /// With the CA in the system bundle, the download goes through: the
    /// agent reads the system's roots, which a compiled-in list would not.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_download_through_a_proxy_ca_the_system_trusts_goes_through() {
        crate::tls_testing::passes_trusting_the_test_ca(
            "runtime::uv::tests::download_with_the_test_ca_in_the_system_bundle",
        );
    }

    #[test]
    #[ignore = "run by a_download_through_a_proxy_ca_the_system_trusts_goes_through, with SSL_CERT_FILE"]
    fn download_with_the_test_ca_in_the_system_bundle() {
        let mirror = TestMirror::start("uv archive bytes");
        assert_eq!(Uv::download(&mirror.url("/uv.tar.gz")).unwrap(), b"uv archive bytes");
    }

    fn zip_with(dir: &Path, entries: &[(&str, &[u8])]) -> PathBuf {
        use std::io::Write;
        let path = dir.join("uv.zip");
        let mut w = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (name, body) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(body).unwrap();
        }
        w.finish().unwrap();
        path
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("igni_uvzip_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn uv_exe_is_copied_out_of_the_windows_release_zip() {
        let dir = scratch("ok");
        let archive = zip_with(
            &dir,
            &[
                ("uv-x86_64-pc-windows-msvc/README.md", b"readme"),
                ("uv-x86_64-pc-windows-msvc/uvx.exe", b"not this one"),
                ("uv-x86_64-pc-windows-msvc/uv.exe", b"MZ uv binary"),
            ],
        );
        let dest = dir.join("uv.exe");
        extract_uv_exe(&archive, &dest).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"MZ uv binary");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_zip_without_uv_exe_is_an_error() {
        let dir = scratch("missing");
        let archive = zip_with(&dir, &[("uv-x86_64-pc-windows-msvc/uvx.exe", b"x")]);
        let err = extract_uv_exe(&archive, &dir.join("uv.exe")).unwrap_err();
        assert!(err.contains("uv.exe not found"), "{err}");
        let _ = fs::remove_dir_all(&dir);
    }

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

    /// The Windows half of the install: the archive is a zip, and the
    /// executable is found in it by name.
    ///
    /// It is Windows-only code, so it only ever runs there — which is
    /// exactly how the zip crate's `name()` could change from a plain
    /// string to a `Result` and break the release build while every
    /// other platform's tests stayed green.
    #[cfg(target_os = "windows")]
    #[test]
    fn the_zip_is_read_for_the_uv_executable() {
        use std::io::Write;

        let mut buffer = std::io::Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file("other.txt", options).unwrap();
            writer.write_all(b"not uv").unwrap();
            writer.start_file("uv.exe", options).unwrap();
            writer.write_all(b"the uv").unwrap();
            writer.finish().unwrap();
        }

        let dir = std::env::temp_dir().join(format!("igni-uv-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("uv.zip");
        fs::write(&archive, buffer.into_inner()).unwrap();

        let uv = Uv::in_dir(&dir);
        assert_eq!(uv.extract(&archive), Ok(()));
        assert_eq!(fs::read(&uv.path).unwrap(), b"the uv");

        fs::remove_dir_all(&dir).unwrap();
    }
}
