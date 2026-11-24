/**
 * A live Python backend for the e2e suite.
 *
 * This used to live inside ``real-be.spec.ts`` behind
 * ``IGNI_E2E_REAL_BE=1``, and the specs that most needed it —
 * ``live-be-plan-decision``, which is the only test that proves the
 * BE's RPC dispatch table routes ``approve_plan`` to the right method
 * with the right argument — sat behind a *different* var,
 * ``IGNI_LIVE_WS``, that nothing set. They ran nowhere. See F128.
 *
 * The gate is now a capability rather than a flag, in this order:
 *
 *   1. ``IGNI_LIVE_WS`` — a backend the developer already has running.
 *      Fastest loop, and the only way to point a spec at the build
 *      you are staring at.
 *   2. Otherwise spawn one, if the project venv exists.
 *   3. Otherwise skip, saying which of the two is missing.
 *
 * A forgotten environment variable is invisible; a missing venv is a
 * fact about the machine. The difference matters, because the first
 * kind of skip is a mistake and the second is a limitation, and only
 * the second should be allowed to pass quietly — which is what
 * ``reporters/skips.ts`` enforces.
 */

import { test as base, type BrowserContext, type Page } from "@playwright/test";
import {
  ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export type LiveBe = {
  /** ``ws://127.0.0.1:PORT`` — what the FE takes as ``?ws=``. */
  wsUrl: string;
  /**
   * The project directory the backend was started against, or null
   * when we are borrowing a backend from ``IGNI_LIVE_WS`` and have no
   * idea where its project lives.
   */
  projectDir: string | null;
  /** How this backend came to be — asserted by the fixture's own test. */
  origin: "spawned" | "IGNI_LIVE_WS";
  /**
   * The backend's per-launch window token, or null when it takes none.
   *
   * A backend started by hand mints one and prints it once; a browser
   * has to offer it as a WebSocket subprotocol or the handshake is
   * refused and the app waits at "Connecting to backend…" forever.
   */
  wsToken: string | null;
  /**
   * The window token the backend requires (``IGNI_WS_TOKEN``), or "" for a
   * borrowed backend started without one. The fixture hands it to every
   * page of the test's browser context as ``window.__IGNI_WS_TOKEN__``, the
   * way an embedder does, so ``?ws=`` alone connects.
   */
  token: string;
  /** The backend's own HOME (``~/.igni`` lives there), or null if borrowed. */
  home: string | null;
  /** SIGKILL the spawned backend (a crash). */
  kill(): Promise<void>;
  /** Start it again on the same port, home, project and token. */
  restart(): Promise<void>;
};

// Project root: walk up from clients/web/e2e/fixtures to the repo root.
// Playwright runs specs as ES modules, so ``__dirname`` is undefined.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
// The backend is igni-core's: its checkout's venv (``uv sync`` there),
// ``IGNI_CORE_DIR`` or ``../igni-core`` beside this repository.
export const IGNI_CORE = process.env.IGNI_CORE_DIR ?? path.resolve(REPO_ROOT, "..", "igni-core");
export const VENV_PYTHON = path.join(IGNI_CORE, ".venv", "bin", "python");

/** The reason a run cannot have a backend, or null if it can. */
export function whyNoBackend(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.IGNI_LIVE_WS) return null;
  if (fs.existsSync(VENV_PYTHON)) return null;
  return (
    `no backend available: ${VENV_PYTHON} does not exist and ` +
    `IGNI_LIVE_WS is unset. Create the venv (\`uv sync\` in an igni-core ` +
    `checkout, IGNI_CORE_DIR or ../igni-core) or point IGNI_LIVE_WS at a ` +
    `running backend.`
  );
}

/**
 * The backend refuses to build its default agent unless the configured
 * model resolves against ``models.registry``, and that registry ships
 * empty — entries arrive from a cloud login or from local config. So
 * write one.
 *
 * It must not read the developer's ``.igni/config.local.yaml``:
 * that path is gitignored, so it is whatever a given machine happens
 * to hold, and on the machine where this was first tried it named a
 * model the registry lacked — the backend died before printing its
 * ready line. Pointing ``models.default`` at a stub we wrote ourselves
 * makes this independent of both the developer's config and of
 * whatever the built-in default is currently called.
 *
 * The URL is the worker's scripted model (``scriptedModel`` below), so
 * the specs that drive the agent loop get a deterministic answer.
 */
const STUB_MODEL = "e2e-scripted";

/** ``scripts/e2e/scripted_model.py``: the deterministic model every spawned
 *  backend talks to. See its docstring for the script a message can carry. */
export const SCRIPTED_MODEL = path.join(REPO_ROOT, "scripts", "e2e", "scripted_model.py");

export type ScriptedModel = {
  /** ``http://127.0.0.1:PORT/v1`` — the registry entry's ``url``. */
  url: string;
  /** Every request the backend made of the model, newest last. */
  requests(sinceMs?: number): ModelRequest[];
};

export type ModelRequest = {
  at: number;
  model: string;
  stream: boolean;
  messages: { role: string; content: unknown; tool_calls?: unknown[] }[];
  tools: string[];
  plan: Record<string, unknown>;
  headers: Record<string, string>;
};

/** A handful of real files, so the ``@`` picker has something to narrow.
 *
 * The specs that exercise file mentions assert on ``calc.py`` specifically.
 * They date from the harness this fixture replaced, which ran the backend
 * against the developer's own repository — so the file was simply there. A
 * throwaway project dir has nothing in it, and every one of those assertions
 * has been failing since: ``.popup-item`` never appears because there is no
 * file to list, and the picker commits the typed text as a chip instead.
 *
 * Verified against the branch tip before this merge: the same failure, the same
 * locator. It is not something the merge introduced.
 *
 * More than one file on purpose. "Narrowing means fewer and right, and both
 * halves matter" is the spec's own comment, and it cannot check "fewer" against
 * a directory holding one thing.
 */
async function writeProjectFiles(projectDir: string): Promise<void> {
  const files: Record<string, string> = {
    "calc.py": "def add(a, b):\n    return a + b\n",
    "calendar_utils.py": "def next_monday():\n    ...\n",
    "main.py": "from calc import add\n\nprint(add(1, 2))\n",
    "README.md": "# e2e fixture project\n",
  };
  await Promise.all(
    Object.entries(files).map(([name, body]) =>
      fsp.writeFile(path.join(projectDir, name), body, "utf8"),
    ),
  );

  // A real project is a git repository, and the backend's file index is built
  // by ``git ls-files --cached --others --exclude-standard`` run with this
  // directory as cwd. Without a repo here that command walks *up* looking for
  // one; on a CI runner it can find an enclosing checkout and answer with that
  // repository's files instead of these. The index then holds the wrong tree,
  // the ``@`` picker lists it, and the mention specs fail intermittently —
  // which is what they did, taking six serial siblings down with them.
  //
  // ``git init`` alone is enough: ``--others`` lists untracked files, so
  // nothing needs committing. Failure is not fatal — the index falls back to a
  // directory walk, which is the path this was on before.
  try {
    await run("git", ["init", "--quiet"], { cwd: projectDir });
  } catch {
    // no git on PATH; the fallback walk still finds these files
  }
}

/**
 * A credentials file the backend will read as "signed in".
 *
 * ``chat/useShellStatus.ts`` derives the sign-in from ``status.cloud_email``, and
 * without one it renders ``SignInWall`` over the entire app. That is
 * correct — artifacts are a cloud service and there is no standalone
 * mode — but it means a spawned backend with no credentials serves
 * every live spec a sign-in form instead of the surface under test.
 * Ten of them timed out waiting for a composer behind it.
 *
 * The file is written inside the fixture's own project directory and
 * named by ``auth.credentials_file`` below, so nothing reads or
 * writes the developer's real ``~/.igni/credentials.json``. The token
 * is not a real one: ``cloud_email`` is read straight off the stored
 * ``email`` field, and no spec here talks to a server.
 */
async function writeFixtureCredentials(projectDir: string): Promise<string> {
  const file = path.join(projectDir, ".igni", "credentials.json");
  const year = 1000 * 60 * 60 * 24 * 365;
  await fsp.writeFile(
    file,
    JSON.stringify(
      {
        access_token: "e2e-fixture-token",
        token_type: "bearer",
        email: "fixture@example.com",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + year).toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  return file;
}

async function writeStubConfig(
  projectDir: string,
  modelUrl: string,
  extraConfig = "",
  extraModels: string[] = [],
): Promise<void> {
  const entry = (id: string) => [
    `    ${id}:`,
    "      provider: openai_like",
    `      model_id: ${id}`,
    `      url: ${modelUrl}`,
    "      context_window: 8192",
    "      vision: false",
  ];
  await fsp.mkdir(path.join(projectDir, ".igni"), { recursive: true });
  const credentials = await writeFixtureCredentials(projectDir);
  await fsp.writeFile(
    path.join(projectDir, ".igni", "config.local.yaml"),
    [
      "auth:",
      `  credentials_file: ${credentials}`,
      "models:",
      `  default: ${STUB_MODEL}`,
      "  registry:",
      ...entry(STUB_MODEL),
      ...extraModels.flatMap(entry),
      extraConfig,
      "",
    ].join("\n"),
    "utf8",
  );
}

/**
 * A home directory of the backend's own, in which the fixture's project is
 * already trusted.
 *
 * Since workspace trust (2fb3bd3e) a folder opened for the first time runs
 * untrusted and the web client shows "Trust this folder?" — a modal whose
 * backdrop covers the composer, the header and the watcher pill. Every
 * spawned project is a fresh temp directory, so every live spec met that
 * dialog and timed out clicking through it (38 CI failures and ~170 serial
 * siblings that "did not run").
 *
 * Trust is recorded per user in ``~/.igni/workspace-trust.json`` and never in
 * the project (a folder must not be able to trust itself), and the backend
 * has no ``--trust`` flag. So the backend gets a ``HOME`` of its own, and the
 * decision is written into it through igni's own trust service — the same
 * record the dialog's "Trust" button writes. This also keeps the spawned
 * backend off the developer's real ``~/.igni``.
 *
 * The same home turns update checks off (``update_check_ttl: 0``). Left on,
 * the backend asks PyPI for a newer igni-core, and whenever PyPI is ahead of
 * the checkout under test — every release, until the checkout catches up —
 * the web client opens "Update available", whose backdrop covers the page as
 * the trust dialog's did. A test run must not depend on PyPI either way.
 */
async function trustedHome(projectDir: string): Promise<string> {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), "igni-live-be-home-"));
  await fsp.mkdir(path.join(home, ".igni"), { recursive: true });
  await fsp.writeFile(path.join(home, ".igni", "config.yaml"), "update_check_ttl: 0\n", "utf8");
  await run(
    VENV_PYTHON,
    [
      "-c",
      "import sys; from igni_core.core.workspace_trust.service import WorkspaceTrust; " +
        "WorkspaceTrust().trust(sys.argv[1])",
      projectDir,
    ],
    { cwd: REPO_ROOT, env: { ...process.env, ...homeEnv(home) } },
  );
  return home;
}

function homeEnv(home: string): NodeJS.ProcessEnv {
  return { HOME: home, USERPROFILE: home };
}

/**
 * The backend's per-launch window token, as it prints it.
 *
 * A backend started by hand has no launcher to hand it a secret, so it
 * mints one, says so once on stderr, and requires it from every window
 * connection: ``igni window token for this backend (shown once, never
 * written to disk): <token>``. The browser offers it as a WebSocket
 * subprotocol (``igni-token.<token>``), which is the one handshake
 * field a page can set.
 *
 * The fixture is the backend's launcher here, so it reads the token off
 * the child's stderr and hands it to the page. Without it every live
 * spec sat at "Connecting to backend…" for its whole timeout: the
 * backend refused the handshake, and the app had no way to say why.
 *
 * See ``igni_core/transport/ws_auth.py``.
 */
const TOKEN_LINE =
  /igni window token for this backend \(shown once, never written to disk\): (\S+)/;

/** The token in the child's stderr so far, or null. */
function tokenIn(stderr: string): string | null {
  const found = TOKEN_LINE.exec(stderr);
  return found ? found[1] : null;
}

/**
 * Hand the token to the page, before it loads anything.
 *
 * The web client reads it from ``window.__IGNI_WS_TOKEN__`` (the
 * desktop shell uses the URL fragment instead — ``#igni_ws_token=``),
 * and reads it when the WebSocket is built, so an init script is the
 * one place that is early enough and late enough.
 */
async function offerToken(page: Page, token: string | null): Promise<void> {
  if (!token) return;
  await page.addInitScript((value) => {
    (
      window as unknown as { __IGNI_WS_TOKEN__?: string }
    ).__IGNI_WS_TOKEN__ = value;
  }, token);
}

function ready(
  proc: ChildProcessWithoutNullStreams,
  token: string | null,
): Promise<{
  wsUrl: string;
  wsToken: string | null;
}> {
  let stderrBuf = "";
  proc.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
  });
  return new Promise<{ wsUrl: string; wsToken: string | null }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `BE did not emit ready line within 30s.\nstderr:\n${stderrBuf}`,
          ),
        );
      }, 30_000);
      let stdoutBuf = "";
      let settled = false;
      proc.stdout.on("data", (chunk) => {
        stdoutBuf += chunk.toString();
        // The ready line is its own JSON envelope on its own line.
        for (const line of stdoutBuf.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("{")) continue;
          try {
            const parsed = JSON.parse(t);
            if (parsed.status === "ready" && parsed.ws_url) {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              // The token is printed before the socket opens, but
              // stderr and stdout are separate pipes, so it may still
              // be on its way when the ready line lands. Give it a
              // moment rather than racing it — and say so plainly if it
              // never arrives, instead of letting every spec time out
              // on "Connecting to backend…".
              // The fixture is the launcher: it put the token in the
              // child's environment, so there is nothing to wait for on
              // stderr.
              if (token) {
                resolve({ wsUrl: String(parsed.ws_url), wsToken: token });
                return;
              }
              const found = tokenIn(stderrBuf);
              if (found) {
                resolve({ wsUrl: String(parsed.ws_url), wsToken: found });
                return;
              }
              let waited = 0;
              const poll = setInterval(() => {
                waited += 50;
                const token = tokenIn(stderrBuf);
                if (token) {
                  clearInterval(poll);
                  resolve({ wsUrl: String(parsed.ws_url), wsToken: token });
                } else if (waited >= 5_000) {
                  clearInterval(poll);
                  reject(
                    new Error(
                      "the backend printed no window token, so the browser " +
                        "cannot authenticate against it. It should print one " +
                        "line, once: " +
                        "'igni window token for this backend (shown once, " +
                        "never written to disk): <token>'. See " +
                        "igni_core/transport/ws_auth.py.\nstderr:\n" +
                        stderrBuf.slice(-2_000),
                    ),
                  );
                }
              }, 50);
              return;
            }
          } catch {
            // partial JSON line; keep buffering
          }
        }
      });
      proc.on("exit", (code) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `BE exited with code ${code} before ready.\nstderr:\n${stderrBuf}`,
          ),
        );
      });
    },
  );
}

async function stop(proc: ChildProcessWithoutNullStreams): Promise<void> {
  // SIGTERM first; hard kill if it lingers past 3s. The Agno team's
  // tail-drain can take a beat after ``shutdown()``.
  proc.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      resolve();
    }, 3_000);
    proc.on("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

const run = promisify(execFile);

/** Every page this context opens gets the token before its scripts run. */
async function giveToken(context: BrowserContext, token: string): Promise<void> {
  await context.addInitScript((t) => {
    (window as unknown as { __IGNI_WS_TOKEN__?: string }).__IGNI_WS_TOKEN__ = t;
  }, token);
}

/**
 * The three watcher specs need an orphan: a row in the project's
 * ``state.db`` naming a pid, and a live OS process at that pid, both in
 * place *before* the backend boots so its rehydrate pass finds them.
 *
 * That used to be a shell ritual — seed, start a backend rooted at the
 * repo, run two specs, clean up, seed the other scenario, start again,
 * run the third — which is four Playwright invocations and two manual
 * phases for three tests. Nobody was going to do that, so nobody did.
 * D9, F129.
 *
 * ``scripts/seed_watcher_e2e_orphan.py`` already took ``--project-dir``,
 * so the whole ritual fits in a fixture: seed a throwaway project, boot
 * the backend against it, tear both down. Each test gets its own
 * orphan, which is also what makes their ``toHaveCount(1)`` assertions
 * honest — the old harness wrote into the developer's *repo*, so two
 * scenarios could not coexist and a stale row from a crashed run would
 * fail the next one.
 */
export type OrphanScenario = "sleep" | "dev_server";

export type DevExtension = "hello" | "broken";

export type LateEnv = { get(): Record<string, string> };
export type LateUrl = { from(scriptedUrl: string): string };

/** The igni CLI beside the venv's python. */
const IGNI_CLI = path.join(IGNI_CORE, ".venv", "bin", "igni");

async function installDevExtensions(home: string, which: DevExtension[]): Promise<void> {
  const env = { ...process.env, ...homeEnv(home), IGNI_DEV_EXTENSIONS: "1" };
  const src = await fsp.mkdtemp(path.join(os.tmpdir(), "igni-ext-src-"));
  try {
    for (const ext of which) {
      if (ext === "hello") {
        await run(IGNI_CLI, ["ext", "init", "--id", "acme.hello", "hello"], { cwd: src, env });
        await run(IGNI_CLI, ["ext", "install", "hello"], { cwd: src, env });
      } else {
        const dir = path.join(home, ".igni", "extensions", "acme.broken");
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, "manifest.json"), '{"id": "acme.broken", "version": ', "utf8");
      }
    }
  } finally {
    await fsp.rm(src, { recursive: true, force: true });
  }
}

const SEED_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "seed_watcher_e2e_orphan.py",
);

async function seedOrphan(
  projectDir: string,
  scenario: OrphanScenario,
  home: string,
): Promise<void> {
  // Under the backend's HOME: the row goes into the project's state.db,
  // which lives in ``~/.igni/data/projects/<id>/`` — not in the project.
  const { stdout } = await run(
    VENV_PYTHON,
    [SEED_SCRIPT, "--scenario", scenario, "--project-dir", projectDir],
    { cwd: REPO_ROOT, env: { ...process.env, ...homeEnv(home) } },
  );
  // The script prints ``scenario=… pid=… pgid=… cmd=…``. If it ever
  // stops seeding and starts no-opping, the spec's own count assertion
  // is the backstop — but fail here first, where the reason is visible.
  if (!/\bpid=\d+/.test(stdout)) {
    throw new Error(`seed did not report a pid:\n${stdout}`);
  }
}

async function cleanupOrphans(projectDir: string, home: string): Promise<void> {
  // Kills every process group the rows reference. Best-effort: a
  // failure here must not mask a test failure, but it must be visible.
  try {
    await run(
      VENV_PYTHON,
      [SEED_SCRIPT, "--cleanup", "--project-dir", projectDir],
      { cwd: REPO_ROOT, env: { ...process.env, ...homeEnv(home) } },
    );
  } catch (err) {
    console.error(`orphan cleanup failed for ${projectDir}: ${String(err)}`);
  }
}

/**
 * Why this run has no model that answers, or null if it has one.
 *
 * A spawned backend talks to ``scripts/e2e/scripted_model.py``, a
 * deterministic OpenAI-compatible server started by the worker fixture
 * below, so whenever a backend can be spawned a model answers — in CI too,
 * with no API key anywhere. It used to point at ``http://127.0.0.1:9``, where
 * nothing listens, and every model-driven spec skipped in CI.
 *
 * A borrowed backend (``IGNI_LIVE_WS``) answers with whatever model its own
 * config names. So the only run without a model is one without a backend.
 */
export function whyNoModel(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return whyNoBackend(env);
}

/**
 * Start one of ``scripts/e2e``'s helper servers (the scripted model, the
 * forward proxy) and resolve with its port once it says it is listening.
 */
export async function startReadyServer(
  script: string,
  args: string[],
): Promise<{ proc: ChildProcessWithoutNullStreams; port: number; stop: () => void }> {
  const python = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
  const proc = spawn(python, [script, ...args], {
    cwd: REPO_ROOT,
  }) as ChildProcessWithoutNullStreams;
  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => reject(new Error(`${script} did not start:\n${err}`)), 15_000);
    proc.stderr.on("data", (c) => (err += c.toString()));
    proc.stdout.on("data", (c) => {
      out += c.toString();
      const m = out.match(/"port":\s*(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${script} exited (${code}):\n${err}`));
    });
  });
  return { proc, port, stop: () => proc.kill("SIGTERM") };
}

export const FORWARD_PROXY = path.join(REPO_ROOT, "scripts", "e2e", "forward_proxy.py");

function readRequests(logPath: string, sinceMs = 0): ModelRequest[] {
  let text = "";
  try {
    text = fs.readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ModelRequest)
    .filter((r) => r.at * 1000 >= sinceMs);
}

export const test = base.extend<
  {
  /**
   * Set with ``test.use({ orphanScenario: "sleep" })`` by the specs that
   * need one. Seeding requires owning the project directory, so asking
   * for a scenario overrides ``IGNI_LIVE_WS``: we cannot seed a backend
   * whose project we did not create.
   */
  orphanScenario: OrphanScenario | null;
  /**
   * Extensions installed for development into the backend's HOME before it
   * starts (``igni ext install`` with ``IGNI_DEV_EXTENSIONS=1``):
   * ``"hello"`` is ``igni ext init --id acme.hello``'s scaffold, a page
   * whose script calls its own backend method; ``"broken"`` is a directory
   * with an unparseable manifest, the faulty extension a backend must
   * survive.
   */
  devExtensions: DevExtension[];
  /** Extra environment for the spawned backend (proxies, CA bundles…).
   *  ``{ get }`` is read when the backend is spawned, for values a
   *  ``beforeAll`` only knows then (a helper server's port). Playwright
   *  takes a bare function in ``test.use`` for a fixture, hence the box. */
  backendEnv: Record<string, string> | LateEnv;
  /** Where the registry points the default model, from the scripted
   *  model's own URL; null keeps that URL. Read at spawn time. */
  modelUrl: LateUrl | null;
  /** Extra top-level YAML for the project's ``.igni/config.local.yaml``. */
  extraConfig: string;
  /** More registry entries on the same scripted model, by id. */
  extraModels: string[];
  liveBe: LiveBe;
  liveWsUrl: string;
  },
  { scriptedModel: ScriptedModel }
>({
  scriptedModel: [
    async ({}, use, workerInfo) => {
      const logPath = path.join(
        os.tmpdir(),
        `igni-scripted-model-${process.pid}-${workerInfo.workerIndex}.jsonl`,
      );
      await fsp.rm(logPath, { force: true });
      const { proc, port } = await startReadyServer(SCRIPTED_MODEL, ["--port", "0", "--log", logPath]);
      try {
        await use({
          url: `http://127.0.0.1:${port}/v1`,
          requests: (sinceMs?: number) => readRequests(logPath, sinceMs),
        });
      } finally {
        proc.kill("SIGTERM");
        await fsp.rm(logPath, { force: true });
      }
    },
    { scope: "worker" },
  ],

  orphanScenario: [null, { option: true }],
  devExtensions: [[], { option: true }],
  backendEnv: [{}, { option: true }],
  extraConfig: ["", { option: true }],
  extraModels: [[], { option: true }],
  modelUrl: [null, { option: true }],

  liveBe: async (
    {
      page,
      orphanScenario,
      devExtensions,
      backendEnv,
      extraConfig,
      extraModels,
      modelUrl,
      context,
      scriptedModel,
    },
    use,
  ) => {
    const borrowed = process.env.IGNI_LIVE_WS;
    if (borrowed && !orphanScenario) {
      // A borrowed backend may want a token of its own. The person
      // running it knows it — it is the line its launcher printed, or
      // the one igni-client's ``Local(url=..., token=...)`` takes.
      const token = (process.env.IGNI_LIVE_WS_TOKEN ?? "").trim();
      if (token) {
        await offerToken(page, token);
        await giveToken(context, token);
      }
      const cannot = async () => {
        throw new Error("a borrowed backend (IGNI_LIVE_WS) cannot be killed or restarted");
      };
      await use({
        wsUrl: borrowed,
        projectDir: null,
        home: null,
        origin: "IGNI_LIVE_WS",
        wsToken: token || null,
        token,
        kill: cannot,
        restart: cannot,
      });
      return;
    }

    const why = whyNoBackend({ ...process.env, IGNI_LIVE_WS: undefined });
    if (why) test.skip(true, why);

    const projectDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), "igni-live-be-"),
    );
    const url = modelUrl ? modelUrl.from(scriptedModel.url) : scriptedModel.url;
    await writeStubConfig(projectDir, url, extraConfig, extraModels);
    await writeProjectFiles(projectDir);
    // Before the backend starts, or its rehydrate pass has nothing to
    // find and the orphan never appears.
    const home = await trustedHome(projectDir);
    if (orphanScenario) await seedOrphan(projectDir, orphanScenario, home);
    if (devExtensions.length) await installDevExtensions(home, devExtensions);

    // The backend requires a window token from every browser connection
    // (igni-core's ``transport/ws_auth.py``). A backend started without
    // one mints its own and prints it once to stderr, which a test cannot
    // reliably read — so the fixture is the launcher here, exactly as the
    // desktop shell is: a per-launch secret in the child's environment.
    // Without this every live spec sat at "Connecting to backend…".
    const token = randomBytes(32).toString("base64url");
    await giveToken(context, token);

    const env = {
      ...process.env,
      ...homeEnv(home),
      // ``_watch_parent`` self-terminates the backend when our PID
      // disappears — no orphaned backends even if Playwright dies
      // mid-test.
      IGNI_PARENT_PID: String(process.pid),
      IGNI_WS_TOKEN: token,
      ...(devExtensions.length ? { IGNI_DEV_EXTENSIONS: "1" } : {}),
      ...(typeof (backendEnv as LateEnv).get === "function"
        ? (backendEnv as LateEnv).get()
        : (backendEnv as Record<string, string>)),
    };
    const start = (port: string) =>
      spawn(
        VENV_PYTHON,
        ["-m", "igni_core.backend", "--ws-port", port, "--project-dir", projectDir],
        { cwd: REPO_ROOT, env },
      ) as ChildProcessWithoutNullStreams;

    let proc = start("0");
    try {
      const { wsUrl, wsToken } = await ready(proc, token);
      const port = new URL(wsUrl).port;
      await offerToken(page, wsToken);
      await use({
        wsUrl,
        projectDir,
        home,
        origin: "spawned",
        wsToken,
        token,
        // The backend dying under the app: SIGKILL, no shutdown path.
        kill: async () => {
          proc.kill("SIGKILL");
          await new Promise<void>((resolve) =>
            proc.exitCode !== null || proc.signalCode !== null ? resolve() : proc.on("exit", () => resolve()),
          );
        },
        // A backend again on the same port, home, project and token — what
        // the desktop shell's Restart Backend does.
        restart: async () => {
          proc = start(port);
          await ready(proc, token);
        },
      });
    } finally {
      await stop(proc);
      // Order matters: the seeded processes outlive the backend by
      // design (that is what makes them orphans), so they have to be
      // killed explicitly, and while the rows naming their pids still
      // exist.
      if (orphanScenario) await cleanupOrphans(projectDir, home);
      await fsp.rm(projectDir, { recursive: true, force: true });
      await fsp.rm(home, { recursive: true, force: true });
    }
  },

  liveWsUrl: async ({ liveBe }, use) => {
    await use(liveBe.wsUrl);
  },
});

export { expect } from "@playwright/test";
