# igni — standalone desktop app (Tauri v2)

Thin native shell around the shared web UI (`clients/web`). On launch it:

1. spawns `python -m igni_core.backend --ws-port 0 --project-dir <arg or cwd>`
   (override the interpreter with `IGNI_PYTHON=/path/to/venv/bin/python`),
2. reads the backend's JSON ready line to learn the bound WS port,
3. opens the web UI pointed at `ws://127.0.0.1:<port>`.

The backend is killed on app exit and also self-terminates if the app
dies (IGNI_PARENT_PID watchdog).

## igni:// links

The app registers the `igni` URL scheme. A link

```
igni://open?open=<page kind>&<key>=<value>…
```

opens the app, or brings its window forward, on that extension page at
that location. The query is the web client's shareable link
(`?open=<page kind>&…`, what its address bar shows), read by the same
code with the same rules: the page kind must look like one, a page gets
at most 16 string params (keys up to 64 characters, values up to 512),
igni's own parameters (`ws`, `host`, `dir`, …) are never a page's, a link
longer than 2048 characters is refused, and a page that is not installed
opens the chat. The shell checks only the scheme and the length
(`src-tauri/src/deep_link.rs`); the window decides what the link opens
(`clients/web/src/chat/arrival.ts`, `Arrivals.fromDeepLink`).
`clients/web/src/chat/deepLinks.cases.json` is the table both are
tested against.

The bundle registers the scheme from `plugins.deep-link` in
`tauri.conf.json`: `CFBundleURLTypes` in the macOS `Info.plist`, a
registry entry written by the Windows installer, and
`MimeType=x-scheme-handler/igni` in the Linux `.desktop` file. On Windows
and Linux the OS starts a second process for a followed link;
`tauri-plugin-single-instance` hands the URL to the running app instead.
A link followed before the app has loaded is held and opened once it has,
after sign-in.

Manual check (an installed bundle, since `cargo run` registers nothing on
macOS): `open 'igni://open?open=plugins'` on macOS,
`xdg-open 'igni://open?open=plugins'` on Linux,
`start igni://open?open=plugins` on Windows. With the app closed it opens
on the Plugins page; with it open and in the background, the window comes
forward on the Plugins page; `igni://open?open=no.such.page` opens the
chat.

## Prerequisites

- Rust toolchain (`rustup`), see https://v2.tauri.app/start/prerequisites/
- Node 20+ (builds `clients/web`)
- `ignite-ember` installed in the Python the app spawns

## Dev

```bash
cd clients/web && npm install && npm run build
cd ../tauri/src-tauri && cargo tauri dev   # or: cargo run
```

Pass a project directory: `cargo run -- /path/to/project`.

## Build

```bash
cd clients/tauri/src-tauri && cargo tauri build
```

> NOTE: not compiled in CI yet — requires the Rust toolchain. The web UI
> and backend protocol it embeds are covered by tests; the Rust shell is
> ~100 lines of spawn/window glue.

## Release signing (macOS)

CI signs the `.app` with a Developer ID Application certificate and
notarizes via Apple's `notarytool`. `tauri-action` handles the full
flow when the secrets below are populated in the repo's Settings →
Secrets and variables → Actions. Until then the macOS bundle ships
ad-hoc-signed and Gatekeeper shows the "unidentified developer"
warning on first launch.

| Secret | Source |
|--------|--------|
| `APPLE_CERTIFICATE` | base64 of the `Developer ID Application` `.p12` exported from Keychain Access (right-click cert → Export → .p12; `base64 -i cert.p12 \| pbcopy`). |
| `APPLE_CERTIFICATE_PASSWORD` | the password you set on the `.p12` during export. |
| `APPLE_SIGNING_IDENTITY` | the full common name of the cert, e.g. `Developer ID Application: Your Name (ABCDE12345)`. Find it with `security find-identity -v -p codesigning`. |
| `APPLE_ID` | the Apple ID email enrolled in the Developer Program. |
| `APPLE_PASSWORD` | an **app-specific password** generated at https://appleid.apple.com (Sign-In and Security → App-Specific Passwords) — NOT your account password. |
| `APPLE_TEAM_ID` | the 10-character team identifier shown in the Developer portal (Membership → Team ID). Also the parenthesized part of `APPLE_SIGNING_IDENTITY`. |

Hardened-runtime entitlements live in
[`src-tauri/entitlements.plist`](src-tauri/entitlements.plist) — they
allow the WebKit JIT and the spawned Python interpreter's unsigned
`.so` wheels to load. Edit there if a future runtime change needs
additional capabilities (e.g. microphone, camera).
