//! Pins on the shell's config files: the capability grant, the CSP, the
//! updater endpoint and the updater's TLS roots. They are read from disk
//! because `tauri-build` parses `tauri.conf.json` against a strict schema
//! that rejects comment keys, so the reasoning lives here instead of beside
//! the values.

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
fn no_window_reaches_the_updater_plugin_directly() {
    // `AppUpdater` is the only thing that builds an `Updater`, so the
    // update policy (air_gapped, update_check_ttl, the managed file, a
    // mirror) decides every request. `updater:default` handed any page
    // script `plugin:updater|check` / `download_and_install`, which went
    // to the compiled endpoint whatever the policy said (R628). The web
    // UI asks through `igni_check_update` / `igni_install_update`.
    let cap = json("capabilities/default.json");
    let granted: Vec<String> = cap["permissions"]
        .as_array()
        .expect("permissions[] missing")
        .iter()
        .map(|p| match p {
            serde_json::Value::String(s) => s.clone(),
            other => other["identifier"].as_str().unwrap_or_default().to_owned(),
        })
        .collect();
    let updater: Vec<&String> = granted.iter().filter(|p| p.starts_with("updater:")).collect();
    assert!(updater.is_empty(), "a window is granted {updater:?}");
}

#[test]
fn capability_default_applies_to_every_app_window() {
    // `main` is the launch window; New Window opens `w-2`, `w-3`, ... A
    // grant scoped to `main` alone left every other window without the
    // opener, dialog and notification bridges.
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

#[test]
fn the_bundle_registers_the_igni_url_scheme() {
    // `igni://open?open=<page>&...` links (src/deep_link.rs). The bundler
    // turns this into CFBundleURLTypes on macOS, the installer's registry
    // entry on Windows and x-scheme-handler/igni in the Linux .desktop
    // file; without it the OS has nothing to hand a link to.
    let conf = json("tauri.conf.json");
    let schemes: Vec<&str> = conf["plugins"]["deep-link"]["desktop"]["schemes"]
        .as_array()
        .expect("plugins.deep-link.desktop.schemes[] missing")
        .iter()
        .filter_map(|s| s.as_str())
        .collect();
    assert_eq!(schemes, vec!["igni"]);
}

#[test]
fn open_path_is_granted_with_a_scope() {
    // `opener:allow-open-path` carries no scope of its own ("Enables the
    // open_path command without any pre-configured scope"), so a bare grant
    // refused every path: `__IGNI_HOST__.openFile` failed with "Not allowed
    // to open path" and fell back to the in-app preview (R632). The grant
    // must name the paths it allows.
    let cap = json("capabilities/default.json");
    let perms = cap["permissions"].as_array().expect("permissions[] missing");
    assert!(
        !perms.iter().any(|p| p.as_str() == Some("opener:allow-open-path")),
        "opener:allow-open-path is granted without a scope"
    );
    let entry = perms
        .iter()
        .find(|p| p["identifier"].as_str() == Some("opener:allow-open-path"))
        .expect("capabilities/default.json must grant opener:allow-open-path");
    let allowed: Vec<&str> = entry["allow"]
        .as_array()
        .expect("opener:allow-open-path needs an allow[] scope")
        .iter()
        .filter_map(|e| e["path"].as_str())
        .collect();
    assert!(allowed.contains(&"$HOME/**"), "the scope must cover the home folder: {allowed:?}");
    assert!(
        !allowed.iter().any(|p| *p == "**" || *p == "/**"),
        "the scope must not open every path on the disk: {allowed:?}"
    );
}

/// The `[[package]]` entry for `name` in Cargo.lock: its version and the
/// names it depends on (a `name version` pair keeps only the name).
fn locked(name: &str) -> Vec<(String, Vec<String>)> {
    let lock = read("Cargo.lock");
    lock.split("[[package]]")
        .filter(|entry| entry.lines().any(|l| l.trim() == format!("name = \"{name}\"")))
        .map(|entry| {
            let version = entry
                .lines()
                .find_map(|l| l.trim().strip_prefix("version = "))
                .unwrap_or_default()
                .trim_matches('"')
                .to_string();
            let deps = entry
                .split_once("dependencies = [")
                .map(|(_, rest)| rest.split(']').next().unwrap_or_default())
                .unwrap_or_default()
                .split(',')
                .filter_map(|d| d.trim().trim_matches('"').split(' ').next().map(str::to_string))
                .filter(|d| !d.is_empty())
                .collect();
            (version, deps)
        })
        .collect()
}

#[test]
fn the_updater_trusts_the_operating_systems_certificate_roots() {
    // An enterprise mirror (`update_endpoint`) is usually served with a
    // certificate from the company's own CA, which IT installs in the OS
    // trust store, not in a list compiled into the app (F13). The updater
    // plugin's HTTP client is reqwest on rustls; with the plugin's default
    // `rustls-tls` feature reqwest verifies through rustls-platform-verifier
    // (Security.framework on macOS, CryptoAPI on Windows, the system bundle
    // via rustls-native-certs on Linux). Two changes would swap that for
    // Mozilla's list compiled in, and the company CA would stop working with
    // no other symptom: reqwest built with webpki-roots, or the plugin with
    // its default features off.
    let manifest = read("Cargo.toml");
    let updater_line = manifest
        .lines()
        .find(|l| l.starts_with("tauri-plugin-updater"))
        .expect("Cargo.toml must depend on tauri-plugin-updater");
    assert!(
        !updater_line.contains("default-features") && !updater_line.contains("features"),
        "tauri-plugin-updater must keep its default features (rustls-tls): {updater_line}"
    );
    let reqwests = locked("reqwest");
    let updaters = locked("tauri-plugin-updater");
    assert_eq!(updaters.len(), 1, "one tauri-plugin-updater in Cargo.lock");
    assert!(updaters[0].1.contains(&"reqwest".to_string()), "the updater's HTTP client is reqwest");
    assert!(!reqwests.is_empty(), "reqwest must be in Cargo.lock");
    for (version, deps) in &reqwests {
        assert!(
            deps.contains(&"rustls-platform-verifier".to_string()),
            "reqwest {version} must verify through rustls-platform-verifier: {deps:?}"
        );
        for bundled in ["webpki-roots", "native-tls", "hyper-tls"] {
            assert!(
                !deps.contains(&bundled.to_string()),
                "reqwest {version} must not be built with {bundled}: {deps:?}"
            );
        }
    }
}

/// Every `.rs` file under `src/`, with its path relative to the crate.
fn sources() -> Vec<(String, String)> {
    fn walk(dir: &std::path::Path, out: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                let rel = path
                    .strip_prefix(env!("CARGO_MANIFEST_DIR"))
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, std::fs::read_to_string(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src"), &mut out);
    out
}

#[test]
fn no_https_client_in_the_shell_falls_back_to_a_compiled_in_root_list() {
    // ureq's `tls` feature carries webpki-roots, Mozilla's list compiled in,
    // and every ureq agent that is not handed a TLS config uses it. That is
    // how uv's download refused a company proxy's CA the system trusted.
    // Every ureq agent is made by `cloud::net::agent_builder`, which hands
    // it rustls with the platform verifier and has no fallback; nothing
    // else builds a root store or names a bundled list.
    let forbidden = [
        "ureq::get(", "ureq::post(", "ureq::put(", "ureq::delete(", "ureq::head(",
        "ureq::patch(", "ureq::request(", "ureq::request_url(", "ureq::agent(", "ureq::builder(",
        "webpki_roots", "webpki_root_certs", "rustls_native_certs", "RootCertStore",
        "with_root_certificates", "danger_accept_invalid_certs", ".dangerous()",
        "native_tls", "add_root_certificate", "tls_built_in_root_certs",
    ];
    let mut builders = Vec::new();
    for (path, text) in sources() {
        if path == "src/tls_testing.rs" {
            continue; // the test server's own config, not a client
        }
        for f in forbidden {
            assert!(!text.contains(f), "{path} uses {f}: HTTPS clients must use cloud::net's platform-TLS agent");
        }
        for (i, _) in text.match_indices("AgentBuilder::new()") {
            builders.push((path.clone(), text[i..].lines().next().unwrap_or_default().to_string()));
        }
        if path != "src/cloud/net.rs" {
            assert!(!text.contains("ClientConfig::builder"), "{path} builds its own rustls ClientConfig; use cloud::net::tls_config");
        }
    }
    assert_eq!(
        builders,
        vec![("src/cloud/net.rs".to_string(), "AgentBuilder::new().tls_config(tls_config(false)?);".to_string())],
        "one ureq AgentBuilder, in cloud::net, handed the platform TLS config with no fallback"
    );
    let net = read("src/cloud/net.rs");
    assert!(net.contains(".with_platform_verifier()?"), "cloud::net's TLS config must use the platform verifier");
    assert!(!net.contains("bundled"), "cloud::net must not fall back to ureq's bundled roots");
}

#[test]
fn a_compiled_in_root_list_reaches_the_build_only_through_ureq() {
    // webpki-roots stays in Cargo.lock because ureq 2's `tls` feature
    // always pulls it (ureq has no rustls feature without it), and the test
    // above keeps every agent off it. A new dependency that brings a
    // bundled list in, and would use it, shows up here first.
    let lock = read("Cargo.lock");
    let users = |root: &str| -> Vec<String> {
        lock.split("[[package]]")
            .filter(|entry| entry.split_once("dependencies = [").is_some_and(|(_, d)| {
                d.split(']').next().unwrap_or_default().split(',').any(|x| {
                    x.trim().trim_matches('"').split(' ').next() == Some(root)
                })
            }))
            .filter_map(|entry| entry.lines().find_map(|l| l.trim().strip_prefix("name = ")).map(|n| n.trim_matches('"').to_string()))
            .collect()
    };
    let mut roots = users("webpki-roots");
    roots.sort();
    roots.dedup();
    assert_eq!(roots, vec!["ureq", "webpki-roots"], "what depends on webpki-roots");
    // rustls-platform-verifier uses webpki-root-certs on wasm32 only.
    assert_eq!(users("webpki-root-certs"), vec!["rustls-platform-verifier"], "what depends on webpki-root-certs");
}
