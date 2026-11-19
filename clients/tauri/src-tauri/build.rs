fn main() {
    tauri_build::build();

    // The app's binary carries Tauri's Windows manifest, which asks for
    // Common Controls v6; a test binary does not. The dialog plugin
    // imports ``TaskDialogIndirect`` from that library, so without the
    // manifest the loader looks for it in Comctl32 v5, which has no such
    // entry point, and the test binary fails to start with
    // STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) before a single test
    // runs.
    //
    // Tauri links its manifest into every target (tauri-apps/tauri
    // #16320, tauri-build 2.8); until that ships, the test targets get
    // the same manifest here.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}", manifest.display());
    }
}
