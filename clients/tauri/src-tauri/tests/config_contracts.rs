//! Pins on the shell's config files: the capability grant, the CSP and the
//! updater endpoint. They are read from disk because `tauri-build` parses
//! `tauri.conf.json` against a strict schema that rejects comment keys, so
//! the reasoning lives here instead of beside the values.

use std::path::PathBuf;

fn read(relative: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn json(relative: &str) -> serde_json::Value {
    serde_json::from_str(&read(relative))
        .unwrap_or_else(|e| panic!("{relative} must be valid JSON: {e}"))
}

#[test]
fn capability_default_grants_opener_open_url() {
    // The init script's link routing is moot if Tauri rejects the invoke
    // at the IPC layer.
    let cap = json("capabilities/default.json");
    let perms = cap["permissions"]
        .as_array()
        .expect("permissions[] missing");
    assert!(
        perms
            .iter()
            .any(|p| p.as_str() == Some("opener:allow-open-url")),
        "capabilities/default.json must grant opener:allow-open-url"
    );
}

#[test]
fn capability_default_applies_to_every_app_window() {
    // `main` is the launch window; New Window opens `w-2`, `w-3`, ... A
    // grant scoped to `main` alone left every other window without the
    // opener, dialog, notification and updater bridges.
    let cap = json("capabilities/default.json");
    let windows: Vec<&str> = cap["windows"]
        .as_array()
        .expect("windows[] missing")
        .iter()
        .filter_map(|w| w.as_str())
        .collect();
    assert!(
        windows.contains(&"main"),
        "capability must apply to the `main` window"
    );
    assert!(
        windows.contains(&"w-*"),
        "capability must apply to New Window's `w-N` windows"
    );
}

#[test]
fn csp_is_set_and_names_no_host_off_this_machine() {
    // F127. The webview renders model output, so it needs a policy.
    //
    // `script-src` stays exactly `'self'`: it is what keeps injected content
    // away from `window.__TAURI__`, which `withGlobalTauri` puts on the page.
    // `style-src` keeps `'unsafe-inline'` because mermaid and
    // rehype-highlight inject `<style>` at runtime; a stylesheet can
    // restyle a page but cannot invoke a command.
    //
    // No source in any directive may name a host off this machine. The
    // first draft ended `connect-src ... https:`, which would have let
    // injected content POST a transcript anywhere; checking every directive
    // catches the same mistake in `img-src` (a tracking pixel) or `font-src`.
    let conf = json("tauri.conf.json");
    let csp = conf["app"]["security"]["csp"]
        .as_str()
        .expect("app.security.csp must be a string, not null");

    let directives: Vec<(&str, Vec<&str>)> = csp
        .split(';')
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(|d| {
            let mut parts = d.split_whitespace();
            let name = parts.next().unwrap_or_default();
            (name, parts.collect())
        })
        .collect();
    let find = |name: &str| {
        directives
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, s)| s.clone())
    };

    assert_eq!(
        find("script-src"),
        Some(vec!["'self'"]),
        "script-src must be exactly 'self' — no unsafe-inline, no unsafe-eval"
    );
    assert_eq!(find("default-src"), Some(vec!["'self'"]));
    assert_eq!(find("object-src"), Some(vec!["'none'"]));
    assert_eq!(find("frame-ancestors"), Some(vec!["'none'"]));
    assert_eq!(find("base-uri"), Some(vec!["'self'"]));

    // A quoted keyword, an inert scheme, Tauri's IPC scheme, or loopback.
    for (name, sources) in &directives {
        for src in sources {
            let ok = src.starts_with('\'')
                || matches!(*src, "data:" | "blob:" | "ipc:")
                || src.starts_with("http://ipc.localhost")
                || src.starts_with("http://127.0.0.1")
                || src.starts_with("http://localhost")
                || src.starts_with("ws://127.0.0.1")
                || src.starts_with("ws://localhost");
            assert!(ok, "{name} names {src}, which is not on this machine — the webview must have no egress off the host");
        }
    }

    // Stated, not inherited from default-src, so the check above reaches them.
    for required in ["style-src", "img-src", "font-src", "connect-src"] {
        assert!(
            find(required).is_some(),
            "{required} must be stated explicitly, not inherited from default-src"
        );
    }
}

#[test]
fn the_compiled_default_is_still_the_vendor_host() {
    // A pin, not an endorsement: changing the endpoint has to be a
    // deliberate decision, and DEC-11's "one outbound host a default
    // install has" stays checkable.
    let conf = read("tauri.conf.json");
    assert!(
        conf.contains("github.com/ignite-ember/igni/releases"),
        "the compiled default endpoint changed; DEC-11 and DP-5 both describe it"
    );
    assert!(
        conf.contains("\"pubkey\""),
        "the updater has no pubkey, so a mirror could serve any build it liked"
    );
}
