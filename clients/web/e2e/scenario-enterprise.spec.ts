/**
 * Enterprise configuration, models, sessions and extensions against a real
 * backend and the scripted model. Scenario ids are
 * docs/ENTERPRISE_TEST_PLAN.md's.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect, test, startReadyServer, FORWARD_PROXY, SCRIPTED_MODEL } from "./fixtures/live-be";
import { assistantSaid, idle, marker, newChat, open, send, shot } from "./fixtures/chat";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const SHOTS = "scenarios/enterprise";

test.describe("behind a corporate proxy", () => {
  const log = path.join(os.tmpdir(), `igni-proxy-${process.pid}.jsonl`);
  let proxy: Awaited<ReturnType<typeof startReadyServer>> | null = null;
  test.beforeAll(async () => {
    fs.rmSync(log, { force: true });
    proxy = await startReadyServer(FORWARD_PROXY, ["--log", log]);
  });
  test.afterAll(() => proxy?.stop());
  test.use({
    backendEnv: {
      get: () => ({
        HTTP_PROXY: `http://127.0.0.1:${proxy!.port}`,
        http_proxy: `http://127.0.0.1:${proxy!.port}`,
        HTTPS_PROXY: `http://127.0.0.1:${proxy!.port}`,
        https_proxy: `http://127.0.0.1:${proxy!.port}`,
        NO_PROXY: "",
        no_proxy: "",
      }),
    },
    // A name only the proxy can resolve: a request that bypassed it fails.
    modelUrl: { from: (u) => u.replace("127.0.0.1", "model.e2e.test") },
  });

  test("ENT-014 the backend reaches the model through HTTP(S)_PROXY", async ({ page, liveBe }) => {
    await open(page, liveBe.wsUrl);
    await newChat(page);
    const token = marker();
    await send(page, `Reply with exactly ${token}.`);
    await assistantSaid(page, token);
    const seen = fs.readFileSync(log, "utf8");
    expect(seen).toMatch(/model\.e2e\.test:\d+\/v1\/chat\/completions/);
  });
});

test.describe("a model host signed by a corporate CA", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "igni-ca-"));
  const ca = path.join(dir, "ca.pem");
  let tls: Awaited<ReturnType<typeof startReadyServer>> | null = null;
  test.beforeAll(async () => {
    const sh = (args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
    sh(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=igni e2e corporate CA",
      "-keyout", "ca.key", "-out", "ca.pem"]);
    fs.writeFileSync(path.join(dir, "ext.cnf"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n");
    sh(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-keyout", "srv.key", "-out", "srv.csr"]);
    sh(["x509", "-req", "-in", "srv.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-days", "2",
      "-extfile", "ext.cnf", "-out", "srv.pem"]);
    tls = await startReadyServer(SCRIPTED_MODEL, [
      "--port", "0", "--tls-cert", path.join(dir, "srv.pem"), "--tls-key", path.join(dir, "srv.key"),
    ]);
  });
  test.afterAll(() => {
    tls?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test.describe("trusted through SSL_CERT_FILE", () => {
    test.use({
      modelUrl: { from: () => `https://localhost:${tls!.port}/v1` },
      backendEnv: { get: () => ({ SSL_CERT_FILE: ca }) },
    });
    test("ENT-037 the backend trusts a corporate CA named in SSL_CERT_FILE", async ({ page, liveBe }) => {
      await open(page, liveBe.wsUrl);
      await newChat(page);
      const token = marker();
      await send(page, `Reply with exactly ${token}.`);
      await assistantSaid(page, token);
    });
  });

  test.describe("not trusted", () => {
    test.use({ modelUrl: { from: () => `https://localhost:${tls!.port}/v1` } });
    test("ENT-038 an untrusted certificate fails the turn visibly, not silently", async ({ page, liveBe }) => {
      await open(page, liveBe.wsUrl);
      await newChat(page);
      await send(page, "Reply with exactly NEVER.");
      await expect(
        page.locator(".conversation").getByText(/certificate|ssl|verify|connection|error/i).first(),
      ).toBeVisible({ timeout: 90_000 });
      await idle(page, 90_000);
      await shot(page, SHOTS, "ent-038-untrusted-cert");
    });
  });
});

test.describe("group policy required", () => {
  test.use({ backendEnv: { IGNI_GROUP_POLICY_REQUIRED: "1" } });
  test("AUTH-014 ENT-008 no verified pack: no turn runs and the person is told why", async ({ page, liveBe, scriptedModel }) => {
    await open(page, liveBe.wsUrl);
    await newChat(page);
    const since = Date.now();
    await send(page, "Reply with exactly BLOCKED.");
    await expect(page.locator(".conversation")).toContainText(/group policy|igni server|organisation|organization/i, {
      timeout: 30_000,
    });
    await idle(page);
    await shot(page, SHOTS, "auth-014-policy-required");
    expect(scriptedModel.requests(since), "the model was called despite the policy").toHaveLength(0);
  });
});

test.describe("group_policy.required in the project's own config", () => {
  test.use({ extraConfig: "group_policy:\n  required: true" });
  test("ENT-009 a managed-only key set by the project is ignored", async ({ page, liveBe }) => {
    await open(page, liveBe.wsUrl);
    await newChat(page);
    const token = marker();
    await send(page, `Reply with exactly ${token}.`);
    await assistantSaid(page, token);
  });
});

test("DIAG-004 the backend writes its log, and no secret is in it", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
  const logs = path.join(liveBe.home!, ".igni", "logs");
  await expect.poll(() => fs.existsSync(logs) && fs.readdirSync(logs).length > 0, { timeout: 15_000 }).toBe(true);
  const text = fs
    .readdirSync(logs)
    .map((f) => fs.readFileSync(path.join(logs, f), "utf8"))
    .join("\n");
  expect(text.length).toBeGreaterThan(0);
  expect(text, "the window token reached the log").not.toContain(liveBe.token);
  expect(text, "the access token reached the log").not.toContain("e2e-fixture-token");
});

test.describe("two models", () => {
  test.use({ extraModels: ["e2e-second"] });

  test("MODEL-003 picking another model sends the next turn to it", async ({ page, liveBe, scriptedModel }) => {
    await open(page, liveBe.wsUrl);
    await newChat(page);
    const chip = page.locator(".composer-model");
    await expect(chip).toContainText("e2e-scripted");
    await chip.click();
    await page.locator(".popup-item", { hasText: "e2e-second" }).first().click();
    await expect(chip).toContainText("e2e-second", { timeout: 15_000 });
    const since = Date.now();
    const token = marker();
    await send(page, `Reply with exactly ${token}.`);
    await assistantSaid(page, token);
    const turn = scriptedModel.requests(since).find((r) => JSON.stringify(r.messages).includes(token));
    expect(turn?.model).toBe("e2e-second");
  });

  test("MODEL-004 switching mid-run lets the run finish and moves the next turn", async ({ page, liveBe, scriptedModel }) => {
    await open(page, liveBe.wsUrl);
    await newChat(page);
    await send(page, "[[slow 200]] [[lines 20]]");
    await assistantSaid(page, "Line 2 of the scripted reply.");
    const chip = page.locator(".composer-model");
    await chip.click();
    await page.locator(".popup-item", { hasText: "e2e-second" }).first().click();
    await assistantSaid(page, "Line 20 of the scripted reply.");
    await idle(page);
    const since = Date.now();
    const token = marker();
    await send(page, `Reply with exactly ${token}.`);
    await assistantSaid(page, token);
    const turn = scriptedModel.requests(since).find((r) => JSON.stringify(r.messages).includes(token));
    expect(turn?.model).toBe("e2e-second");
  });
});

test("SESS-005 a cleared session is still there to reopen from the sidebar", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
  await idle(page);
  const old = (await page.locator(".session-chip code").innerText()).trim();
  await newChat(page);
  await expect(page.locator(".conversation")).not.toContainText(token);
  await page.locator(".sidebar, nav, aside").getByText(old.slice(0, 8)).first().click();
  await expect(page.locator(".session-chip code")).toHaveText(old, { timeout: 15_000 });
  await assistantSaid(page, token, 15_000);
});

test.describe("a development extension", () => {
  test.use({ devExtensions: ["hello", "broken"] });

  test("EXT-022 EXT-023 its page opens and reaches its backend; a broken one beside it harms nothing", async ({ page, liveBe }) => {
    await open(page, liveBe.wsUrl);
    const entry = page.getByText("hello", { exact: true }).first();
    await expect(entry).toBeVisible({ timeout: 60_000 });
    await entry.click();
    const frame = page.frameLocator("iframe").first();
    await expect(frame.getByText("hello from the extension backend")).toBeVisible({ timeout: 60_000 });
    await shot(page, SHOTS, "ext-022-page");
    // The chat still works with the broken extension installed.
    await page.getByText("Chat", { exact: true }).first().click().catch(() => undefined);
    await newChat(page);
    const token = marker();
    await send(page, `Reply with exactly ${token}.`);
    await assistantSaid(page, token);
  });

  test("EXT-024 a shareable link opens the page directly", async ({ page, liveBe }) => {
    await open(page, liveBe.wsUrl, "&open=acme.hello.main");
    const frame = page.frameLocator("iframe").first();
    await expect(frame.getByText("hello from the extension backend")).toBeVisible({ timeout: 60_000 });
  });

  test("SEC-026 the extension page is served with a restrictive CSP", async ({ page, liveBe }) => {
    await open(page, liveBe.wsUrl, "&open=acme.hello.main");
    const src = await page.locator("iframe").first().getAttribute("src", { timeout: 60_000 });
    expect(src).toBeTruthy();
    const res = await page.request.get(src!);
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp, "the extension page has no CSP").toContain("script-src");
    expect(csp).toMatch(/frame-ancestors/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
