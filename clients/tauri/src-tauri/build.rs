//! tauri-build, with the Windows application manifest linked into every
//! binary the crate makes rather than into the app's binary alone.
//!
//! The manifest declares Common Controls v6, the comctl32.dll that has
//! `TaskDialogIndirect` (tauri-runtime-wry's and muda's dialogs call it).
//! tauri-build's default puts it in the resource file, which embed-resource
//! links into bins only, so the lib's unit-test binary loads the system's
//! comctl32 v5, and once a test builds an `App` (the updater tests on
//! Tauri's mock runtime) Windows refuses to start it:
//! `0xc0000139, STATUS_ENTRYPOINT_NOT_FOUND`. Tauri's own crate does the
//! same for its tests (`embed_manifest_for_tests` in tauri's build.rs):
//! the linker embeds the manifest file itself, for every target. The app
//! gets the same manifest as before, by the linker instead of the .rc.

fn main() {
    let msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let windows = if msvc {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        // The .rc keeps the icon and version info; the manifest is the
        // linker's, so the two cannot clash.
        tauri_build::WindowsAttributes::new_without_app_manifest()
    } else {
        tauri_build::WindowsAttributes::new()
    };
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
