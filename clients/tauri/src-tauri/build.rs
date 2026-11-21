fn main() {
    // On Windows the manifest that asks for Common Controls v6 has to be
    // linked into every target of the package.
    //
    // Tauri compiles its manifest into the app's binary as a Windows
    // resource, so the binary gets it and the test binaries do not. The
    // dialog code imports ``TaskDialogIndirect`` from that library of
    // controls; without the manifest the loader looks for it in Comctl32
    // v5, which has no such entry point, and a test binary fails to
    // start with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) before a single
    // test runs (tauri-apps/tauri#4383).
    //
    // So the manifest is linked in here instead — the way Tauri does it
    // for its own workspace (tauri-apps/tauri#16320) — and tauri-build
    // is told not to compile one of its own, so that no binary carries
    // two manifests (the linker refuses that as a duplicate resource).
    let windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");

    let mut attributes = tauri_build::Attributes::new();
    if windows {
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new_without_app_manifest(),
        );
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");

    if windows {
        // A copy of tauri-build's ``src/windows-app-manifest.xml``; the
        // file there is not public API, so it is kept here.
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
