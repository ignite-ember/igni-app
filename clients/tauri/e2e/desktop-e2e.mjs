#!/usr/bin/env node
// Desktop end-to-end scenarios for igni's Tauri app, driven through
// tauri-driver (WebKitWebDriver on Linux, msedgedriver on Windows).
//
// Every scenario id is docs/ENTERPRISE_TEST_PLAN.md's. The model is
// scripts/e2e/scripted_model.py — no API key anywhere — and the app runs
// with a HOME of its own, so nothing on the runner's account is read or
// written.
//
//   node desktop-e2e.mjs --suite first-launch   # managed runtime from a local index, chat,
//                                               # approval, extension page, igni:// link, CSP, quit
//   node desktop-e2e.mjs --suite air-gapped     # no runtime and IGNI_AIR_GAPPED=1: a refusal, no download
//   node desktop-e2e.mjs --suite provisioned    # a managed-settings file names runtime_python and an
//                                               # update_endpoint; the app starts on it and asks only it
//
// Environment:
//   IGNI_APP          the installed app's binary (required)
//   IGNI_E2E_PYTHON   a Python with igni-core installed (the provisioned runtime, the igni CLI
//                     for the dev extension, and the scripted model)
//   IGNI_E2E_INDEX    first-launch only: the local package index (UV_INDEX_URL) the runtime
//                     installs igni-core from
//   IGNI_E2E_OUT      where screenshots and results.json go (default ./desktop-e2e-out)
//   TAURI_DRIVER      the tauri-driver binary (default: on PATH)
//   NATIVE_DRIVER     the native WebDriver (msedgedriver on Windows), passed to tauri-driver

import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as http from "node:http";

import { Session } from "./webdriver.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const SCRIPTED_MODEL = path.join(REPO, "scripts", "e2e", "scripted_model.py");
const WIN = process.platform === "win32";
const READY = /Message (Ember|igni)/;

const suite = process.argv[process.argv.indexOf("--suite") + 1] || "first-launch";
const APP = must("IGNI_APP");
const PYTHON = process.env.IGNI_E2E_PYTHON || (WIN ? "python" : "python3");
const OUT = path.resolve(process.env.IGNI_E2E_OUT || "desktop-e2e-out", suite);
fs.mkdirSync(OUT, { recursive: true });

function must(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required`);
    process.exit(2);
  }
  return v;
}

// ── results ────────────────────────────────────────────────────────────

const results = [];
let session = null;

async function step(id, title, fn) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${id} ${title}\n`);
  try {
    await fn();
    results.push({ id, title, ok: true, ms: Date.now() - started });
    process.stdout.write(`  ✓ ${id} (${Date.now() - started} ms)\n`);
  } catch (err) {
    results.push({ id, title, ok: false, ms: Date.now() - started, error: String(err?.stack || err) });
    process.stdout.write(`  ✗ ${id}: ${err?.message || err}\n`);
    await shot(`${id}-FAILED`).catch(() => undefined);
    if (session) {
      const text = await session.bodyText().catch(() => "");
      fs.writeFileSync(path.join(OUT, `${id}-FAILED.txt`), String(text));
    }
    throw err;
  }
}

async function shot(name) {
  if (!session) return;
  const png = await session.screenshot();
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(png, "base64"));
}

function finish(code) {
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ suite, results }, null, 2));
  const lines = [`### Desktop E2E — ${suite} (${process.platform})`, "", "| Scenario | Result | Time |", "|---|---|---|"];
  for (const r of results) lines.push(`| ${r.id} ${r.title} | ${r.ok ? "pass" : "**FAIL**"} | ${(r.ms / 1000).toFixed(1)} s |`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n\n");
  console.log("\n" + lines.join("\n"));
  process.exit(code);
}

// ── helpers ────────────────────────────────────────────────────────────

/** A helper server from scripts/e2e that prints {"port": N} when ready. */
function startServer(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [script, ...args], { env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    const t = setTimeout(() => reject(new Error(`${script} did not start: ${err}`)), 20_000);
    proc.stderr.on("data", (c) => (err += c));
    proc.stdout.on("data", (c) => {
      out += c;
      const m = out.match(/"port":\s*(\d+)/);
      if (m) {
        clearTimeout(t);
        resolve({ proc, port: Number(m[1]) });
      }
    });
    proc.on("exit", (code) => reject(new Error(`${script} exited ${code}: ${err}`)));
  });
}

/** A throwaway HOME with a project, the scripted model and a signed-in user. */
function makeHome(modelPort) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `igni-desktop-${suite}-`));
  // On Windows the shell finds the profile through the known-folder API,
  // not USERPROFILE, so a HOME of its own is not possible there: the
  // runner's (throwaway) profile is used, and the backend agrees with it.
  const home = WIN ? os.homedir() : path.join(root, "home");
  const project = path.join(root, "project");
  fs.mkdirSync(path.join(home, ".igni"), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "README.md"), "# desktop e2e project\n");
  fs.writeFileSync(path.join(project, "calc.py"), "def add(a, b):\n    return a + b\n");
  fs.writeFileSync(
    path.join(home, ".igni", "config.yaml"),
    [
      "models:",
      "  default: e2e-scripted",
      "  registry:",
      "    e2e-scripted:",
      "      provider: openai_like",
      "      model_id: e2e-scripted",
      `      url: http://127.0.0.1:${modelPort}/v1`,
      "      context_window: 8192",
      "      vision: false",
      "",
    ].join("\n"),
  );
  // Signed in: the app gates everything behind organisation sign-in, and
  // the backend reads the e-mail straight from this file. Not a real token.
  const year = 365 * 24 * 3600 * 1000;
  fs.writeFileSync(
    path.join(home, ".igni", "credentials.json"),
    JSON.stringify({
      access_token: "desktop-e2e-fixture-token",
      token_type: "bearer",
      email: "desktop@example.com",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + year).toISOString(),
    }),
  );
  return { root, home, project };
}

/** The environment the app (through tauri-driver) runs in. */
function appEnv(home, extra = {}) {
  const env = { ...process.env, ...extra };
  if (!WIN) {
    env.HOME = home;
    env.XDG_CONFIG_HOME = path.join(home, ".config");
    env.XDG_DATA_HOME = path.join(home, ".local", "share");
    env.XDG_CACHE_HOME = path.join(home, ".cache");
  }
  return env;
}

/** The managed runtime's cache, as the shell resolves it. */
function managedCache(home) {
  if (WIN) return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "igni");
  if (process.platform === "darwin") return path.join(home, "Library", "Caches", "igni");
  return path.join(home, ".cache", "igni");
}

let driver = null;

async function startDriver(env) {
  const bin = process.env.TAURI_DRIVER || "tauri-driver";
  const args = ["--port", "4444"];
  if (process.env.NATIVE_DRIVER) args.push("--native-driver", process.env.NATIVE_DRIVER);
  driver = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(OUT, "tauri-driver.log"));
  driver.stdout.pipe(log);
  driver.stderr.pipe(log);
  const end = Date.now() + 30_000;
  for (;;) {
    try {
      const r = await fetch("http://127.0.0.1:4444/status");
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) throw new Error("tauri-driver did not come up on :4444");
    await sleep(500);
  }
}

async function stopDriver() {
  if (session) await session.quit();
  session = null;
  if (driver) {
    driver.kill();
    driver = null;
  }
  await sleep(2_000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(project) {
  session = await Session.start("http://127.0.0.1:4444", APP, { args: [project] });
}

/** Wait for the chat: the composer's placeholder leaves "Connecting…". */
async function waitForChat(timeout) {
  await session.waitFor(
    "the chat to be ready",
    async () => {
      // A first-run "Trust this folder?" dialog sits over the composer.
      await session.exec(
        "const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Trust'); if(b) b.click();",
      );
      const failed = await session.exec(
        "const e=document.querySelector('.igni-loading-error'); return e ? e.textContent : null",
      );
      if (failed) throw new Error(`bootstrap failed in the window: ${failed}`);
      const ph = await session.exec(
        "const e=document.querySelector('.composer-editable'); return e ? e.getAttribute('data-placeholder') : null",
      );
      return ph && READY.test(ph);
    },
    { timeout, interval: 1_000 },
  );
}

async function send(text) {
  const editor = await session.find(".composer-editable");
  await editor.click();
  await editor.type(text);
  await editor.type(""); // Enter
}

async function assistantSaid(text, timeout = 60_000) {
  await session.waitFor(`the reply "${text}"`, async () =>
    session.exec(
      "return [...document.querySelectorAll('.msg-assistant')].some(e => e.textContent.includes(arguments[0]))",
      text,
    ),
    { timeout },
  );
}

function marker() {
  return `TKN${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
}

/** igni_core.backend processes whose command line names `needle`. */
function backends(needle) {
  try {
    if (WIN) {
      const out = execFileSync("powershell", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*igni_core.backend*' } | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }",
      ]).toString();
      return out.split(/\r?\n/).filter((l) => l.includes(needle));
    }
    const out = execFileSync("ps", ["-eo", "pid=,args="]).toString();
    return out.split("\n").filter((l) => l.includes("igni_core.backend") && l.includes(needle));
  } catch {
    return [];
  }
}

let linkEnv = process.env;

function openLink(url) {
  if (WIN) execFileSync("cmd", ["/c", "start", "", url]);
  else if (process.platform === "darwin") execFileSync("open", [url]);
  else execFileSync("xdg-open", [url], { env: linkEnv });
}

// ── suites ─────────────────────────────────────────────────────────────

async function firstLaunch() {
  const model = await startServer(SCRIPTED_MODEL, ["--port", "0"]);
  const { home, project } = makeHome(model.port);
  const index = must("IGNI_E2E_INDEX");

  // A development extension, installed the documented way into this HOME.
  const igni = WIN ? path.join(path.dirname(PYTHON), "igni.exe") : path.join(path.dirname(PYTHON), "igni");
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "igni-ext-"));
  // PYTHONIOENCODING: `igni ext init` prints "→", which a Windows console's
  // cp1252 cannot encode, and the command dies with UnicodeEncodeError
  // (an igni-core bug, reported with this suite).
  const extEnv = { ...appEnv(home), IGNI_DEV_EXTENSIONS: "1", PYTHONIOENCODING: "utf-8" };
  execFileSync(igni, ["ext", "init", "--id", "acme.hello", "hello"], { cwd: src, env: extEnv, stdio: "inherit" });
  execFileSync(igni, ["ext", "install", "hello"], { cwd: src, env: extEnv, stdio: "inherit" });

  const env = appEnv(home, {
    IGNI_DEV_EXTENSIONS: "1",
    // The runtime install goes to the organisation's own index, never PyPI.
    UV_INDEX_URL: index,
    UV_DEFAULT_INDEX: index,
    // No 1.7 GB model download in CI: the prefetch fails fast and is not
    // fatal (igni_core.prefetch_models), which is the documented contract.
    HF_HUB_OFFLINE: "1",
  });
  linkEnv = env;
  await startDriver(env);

  await step("PLAT-012 PLAT-001", "first launch installs the runtime from the local index and opens the chat", async () => {
    await launch(project);
    await sleep(3_000);
    await shot("01-loading");
    await waitForChat(25 * 60_000);
    await shot("02-chat-ready");
  });

  await step("CHAT-002", "a question gets a streamed answer", async () => {
    const t = marker();
    await send(`Reply with exactly ${t}.`);
    await assistantSaid(t);
    await shot("03-answered");
  });

  await step("TOOL-003", "an approval is asked, granted, and the tool runs", async () => {
    const t = marker();
    await send(`[[tool run_shell_command {"command":"${WIN ? "echo ok> approved.txt" : "touch approved.txt"}"}]] then say ${t}`);
    await session.waitFor("the approval card", () => session.exec("return !!document.querySelector('.hitl-card')"), { timeout: 60_000 });
    await shot("04-approval");
    await session.exec(
      "[...document.querySelectorAll('.hitl-card button')].find(b => b.textContent.trim() === 'Allow once').click()",
    );
    await assistantSaid(t);
    if (!fs.existsSync(path.join(project, "approved.txt"))) throw new Error("the approved command did not run");
    await shot("05-tool-done");
  });

  await step("SEC-024", "the window's CSP blocks an injected inline script", async () => {
    const ran = await session.execAsync(
      "const done = arguments[arguments.length - 1];" +
        "const s = document.createElement('script'); s.textContent = 'window.__inl = 1';" +
        "document.head.appendChild(s); setTimeout(() => done(window.__inl === 1), 500);",
    );
    if (ran) throw new Error("an inline script ran in the app window");
  });

  await step("EXT-022", "the development extension's page opens and reaches its backend", async () => {
    await session.waitFor("the extension's sidebar entry", () =>
      session.exec("return [...document.querySelectorAll('*')].some(e => e.children.length === 0 && e.textContent.trim() === 'hello')"),
      { timeout: 60_000 },
    );
    await session.exec(
      "[...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'hello').click()",
    );
    await session.waitFor("the extension frame", () => session.exec("return !!document.querySelector('iframe')"), { timeout: 60_000 });
    // The frame is another origin; its content is checked by switching into it.
    // Into the frame: by reference, the W3C way; WebKitWebDriver refuses
    // that ("Invalid frame ID object"), so by index (the page has one frame).
    const frame = await session.find("iframe");
    try {
      await session.cmd("POST", "/frame", { id: { "element-6066-11e4-a52f-4f735466cecf": frame.id } });
    } catch {
      await session.cmd("POST", "/frame", { id: 0 });
    }
    await session.waitFor("the page's answer from its backend", async () =>
      (await session.bodyText()).includes("hello from the extension backend"),
      { timeout: 60_000 },
    );
    await session.cmd("POST", "/frame", { id: null });
    await shot("06-extension-page");
  });

  await step("EXT-007 PLAT-014 PLAT-011", "an igni:// link brings the running app to a page", async () => {
    // Back to the chat first, so arriving on the page is the link's doing.
    await session.exec("const n=[...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'Chat'); if (n) n.click();");
    await sleep(1_000);
    openLink("igni://open?open=plugins");
    await session.waitFor("the Plugins page after the link", async () => {
      const handles = await session.windowHandles();
      for (const h of handles) {
        await session.switchTo(h);
        const where = await session.exec("return location.search");
        const t = await session.bodyText();
        if (/open=plugins/.test(where) || /No marketplaces configured|Marketplace/.test(t)) return true;
      }
      return false;
    }, { timeout: 60_000 });
    await shot("07-deep-link");
  });

  await step("ENT-032", "quitting the app leaves no backend behind", async () => {
    if (backends(project).length === 0) throw new Error("no backend was running for the project before quit");
    await stopDriver();
    const end = Date.now() + 30_000;
    while (backends(project).length && Date.now() < end) await sleep(1_000);
    const left = backends(project);
    if (left.length) throw new Error(`backend still running after quit:\n${left.join("\n")}`);
  });
  model.proc.kill();
}

async function airGapped() {
  const model = await startServer(SCRIPTED_MODEL, ["--port", "0"]);
  const { home, project } = makeHome(model.port);
  // No provisioned runtime and no managed one: the install must refuse.
  await startDriver(appEnv(home, { IGNI_AIR_GAPPED: "1" }));
  await step("ENT-016", "air-gapped with no runtime refuses to download and says what to do", async () => {
    await launch(project);
    const text = await session.waitFor("the refusal", async () => {
      const t = await session.exec("const e=document.querySelector('.igni-loading-error'); return e ? e.textContent : null");
      return t;
    }, { timeout: 120_000 });
    await shot("air-gapped-refusal");
    if (!/air-gapped/i.test(text) || !/runtime_python/.test(text)) throw new Error(`unexpected refusal: ${text}`);
    if (fs.existsSync(path.join(managedCache(home), "venv"))) throw new Error("a managed venv was created while air-gapped");
  });
  await stopDriver();
  model.proc.kill();
}

async function provisioned() {
  // The workflow has written the managed-settings file (root-owned):
  //   air_gapped: true, runtime_python: <IGNI_E2E_PYTHON>,
  //   update_endpoint: http://127.0.0.1:<IGNI_E2E_UPDATE_PORT>/latest.json
  // (plain HTTP on purpose: ENT-024, the updater must refuse it)
  const model = await startServer(SCRIPTED_MODEL, ["--port", "0"]);
  const { home, project } = makeHome(model.port);
  const hits = [];
  const port = Number(must("IGNI_E2E_UPDATE_PORT"));
  const mirror = http
    .createServer((req, res) => {
      hits.push(req.url);
      // No newer version: an answer the updater accepts as "up to date".
      res.writeHead(204);
      res.end();
    })
    .listen(port, "127.0.0.1");
  await startDriver(appEnv(home));

  await step("ENT-015", "a managed runtime_python starts the app air-gapped, with no download", async () => {
    await launch(project);
    await waitForChat(5 * 60_000);
    await shot("provisioned-chat");
    const t = marker();
    await send(`Reply with exactly ${t}.`);
    await assistantSaid(t);
    // The backend runs on the provisioned interpreter, not a managed venv.
    const running = backends(project);
    if (running.length === 0) throw new Error("no backend for the project");
    const want = path.resolve(PYTHON).toLowerCase();
    if (!running.some((l) => l.toLowerCase().includes(want))) {
      throw new Error(`the backend is not on runtime_python (${want}):\n${running.join("\n")}`);
    }
  });

  await step("ENT-024", "a plain-HTTP managed update_endpoint is refused, with no fallback to the vendor's", async () => {
    const answer = await session.execAsync(
      "const done = arguments[arguments.length - 1];" +
        "window.__TAURI__.core.invoke('igni_check_update').then(r => done(JSON.stringify(r)), e => done('error: ' + e));",
    );
    console.log(`  update check answered: ${answer}`);
    // The updater accepts only https mirrors; the check must say so and
    // name the managed endpoint, not quietly ask the compiled one.
    if (!/^error: /.test(answer) || !answer.includes(`127.0.0.1:${port}/latest.json`)) {
      throw new Error(`expected a refusal naming the managed endpoint, got: ${answer}`);
    }
    if (hits.length) throw new Error(`the refused endpoint was asked anyway: ${JSON.stringify(hits)}`);
  });

  await stopDriver();
  mirror.close();
  model.proc.kill();
}

const SUITES = { "first-launch": firstLaunch, "air-gapped": airGapped, provisioned };

try {
  await SUITES[suite]();
  finish(results.every((r) => r.ok) ? 0 : 1);
} catch (err) {
  console.error(err);
  await stopDriver().catch(() => undefined);
  finish(1);
}
