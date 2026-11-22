/**
 * Security scenarios against a real backend: hostile model output, link
 * injection, and the local WebSocket's token and Origin checks. Scenario
 * ids are docs/ENTERPRISE_TEST_PLAN.md's.
 *
 * "Hostile" here means the model is the attacker — a prompt injection in a
 * file it read can make it say anything — so every payload is something
 * the scripted model replies verbatim (``sayExactly``). A payload that runs
 * sets ``window.__pwned``; every test ends by asserting it never was.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "./fixtures/live-be";
import {
  assistantSaid,
  callTool,
  idle,
  marker,
  newChat,
  open,
  sayExactly,
  send,
  shot,
} from "./fixtures/chat";
import type { Page } from "@playwright/test";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const SHOTS = "scenarios/security";

/** Any dialog (alert/confirm/prompt) is a payload that ran. */
function failOnDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on("dialog", async (d) => {
    seen.push(`${d.type()}: ${d.message()}`);
    await d.dismiss();
  });
  return seen;
}

async function notPwned(page: Page, dialogs: string[]) {
  expect(await page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
  expect(dialogs, "a payload opened a dialog").toEqual([]);
}

test("SEC-001 script and HTML in the model's markdown render as text", async ({ page, liveBe }) => {
  const dialogs = failOnDialogs(page);
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  const payload = [
    `Here you go ${token}`,
    "<script>window.__pwned = 'script'</script>",
    '<img src="x" onerror="window.__pwned = \'img\'; alert(1)">',
    '<iframe src="javascript:parent.__pwned=\'iframe\'"></iframe>',
    '<svg onload="window.__pwned=\'svg\'"></svg>',
    '<a href="#" onclick="window.__pwned=\'onclick\'">click me</a>',
    "<style>body{display:none}</style>",
  ].join("\n\n");
  await send(page, sayExactly(payload));
  await assistantSaid(page, token);
  await idle(page);

  const reply = page.locator(".msg-assistant").filter({ hasText: token }).first();
  for (const tag of ["script", "img[onerror]", "iframe", "svg[onload]", "a[onclick]", "style"]) {
    await expect(reply.locator(tag), `a <${tag}> from the model reached the DOM`).toHaveCount(0);
  }
  // Shown as text, so the person can see what the model tried.
  await expect(reply).toContainText("<script>");
  await reply.getByText("click me").first().click({ trial: false }).catch(() => undefined);
  await expect(page.locator("body")).toBeVisible();
  await notPwned(page, dialogs);
  await shot(page, SHOTS, "sec-001-hostile-html");
});

test("SEC-002 javascript:, data: and vbscript: links in a reply are inert", async ({ page, liveBe }) => {
  const dialogs = failOnDialogs(page);
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  const payload = [
    `Links ${token}:`,
    "[js link](javascript:window.__pwned='js')",
    "[js entity](jav&#x09;ascript:window.__pwned='entity')",
    "[data link](data:text/html,<script>parent.__pwned='data'</script>)",
    "[vb link](vbscript:msgbox(1))",
    "![img](javascript:window.__pwned='imgsrc')",
  ].join("\n\n");
  await send(page, sayExactly(payload));
  await assistantSaid(page, token);
  const reply = page.locator(".msg-assistant").filter({ hasText: token }).first();
  const hrefs = await reply.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  for (const href of hrefs) {
    expect(href.toLowerCase().replace(/\s/g, ""), `unsafe href rendered: ${href}`).not.toMatch(/^(javascript|data|vbscript):/);
  }
  const srcs = await reply.locator("img").evaluateAll((is) => is.map((i) => i.getAttribute("src") ?? ""));
  for (const src of srcs) expect(src.toLowerCase()).not.toMatch(/^javascript:/);
  for (const name of ["js link", "js entity", "data link", "vb link"]) {
    const link = reply.getByText(name).first();
    if (await link.count()) await link.click().catch(() => undefined);
  }
  await expect(page.locator(".composer-editable")).toBeVisible();
  expect(page.url()).toContain("127.0.0.1:5179");
  await notPwned(page, dialogs);
});

test("SEC-004 an external link in a reply opens apart from the app, without an opener", async ({ page, context, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  await send(page, sayExactly(`See [the docs](https://example.com/phish?${token}) ${token}`));
  await assistantSaid(page, token);
  const link = page.locator(".msg-assistant a", { hasText: "the docs" }).first();
  await expect(link).toHaveAttribute("href", /^https:\/\/example\.com\//);
  // Clicking must not navigate the app itself away (losing the session),
  // and the new page must get no handle on the app (reverse tabnabbing).
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  await context.route("https://example.com/**", (r) => r.fulfill({ body: "<p>outside</p>", contentType: "text/html" }));
  const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  expect(page.url()).toContain("127.0.0.1:5179");
  await expect(page.locator(".composer-editable")).toBeVisible();
});

test("SEC-032 a mermaid diagram from the model cannot run script", async ({ page, liveBe }) => {
  const dialogs = failOnDialogs(page);
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  const payload = [
    `Diagram ${token}`,
    "```mermaid",
    "graph TD",
    '  A["<img src=x onerror=window.__pwned=\'mermaid\'>"] --> B',
    "  click A \"javascript:window.__pwned='click'\"",
    "  B --> C[\"<script>window.__pwned='label'</script>\"]",
    "```",
  ].join("\n");
  await send(page, sayExactly(payload));
  await assistantSaid(page, token);
  await idle(page);
  await page.waitForTimeout(2_000);
  const reply = page.locator(".msg-assistant").filter({ hasText: token }).first();
  await expect(reply.locator("img[onerror], script")).toHaveCount(0);
  const nodes = reply.locator("svg .node, svg g").first();
  if (await nodes.count()) await nodes.click({ force: true }).catch(() => undefined);
  await notPwned(page, dialogs);
  await shot(page, SHOTS, "sec-032-mermaid");
});

test("SEC-008 a hostile file name in a tool result renders as text", async ({ page, liveBe }) => {
  const dialogs = failOnDialogs(page);
  const evil = `<img src=x onerror=window.__pwned='file'>.py`;
  fs.writeFileSync(path.join(liveBe.projectDir!, evil), "x = 1\n");
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  await send(page, `${callTool("run_shell_command", { command: "ls -1" })} then say ${token}`);
  const card = page.locator(".hitl-card");
  await expect(page.locator(".hitl-card, .tool-card").first()).toBeVisible({ timeout: 30_000 });
  if (await card.isVisible().catch(() => false)) await card.getByRole("button", { name: "Allow once" }).click();
  await assistantSaid(page, token);
  await page.locator(".tool-card").first().click().catch(() => undefined);
  await expect(page.locator(".conversation img[onerror]")).toHaveCount(0);
  // The @ picker lists the same file.
  const editor = page.locator(".composer-editable");
  await editor.click();
  await editor.type("@img");
  await page.waitForTimeout(1_500);
  await expect(page.locator("img[onerror]")).toHaveCount(0);
  await editor.press("Escape");
  await notPwned(page, dialogs);
  await shot(page, SHOTS, "sec-008-hostile-filename");
});

test("SEC-007 an oversized reply (2 MB on one line) does not take the app down", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  // The scripted model sends 2 MB of one unbroken word, then the token.
  await send(page, `[[big 2097152]] ${token}`);
  await assistantSaid(page, token, 90_000);
  await idle(page, 90_000);
  const ms = await page.evaluate(
    () => new Promise<number>((r) => { const t = performance.now(); requestAnimationFrame(() => r(performance.now() - t)); }),
  );
  expect(ms).toBeLessThan(2_000);
  const next = marker();
  await send(page, `Reply with exactly ${next}.`);
  await assistantSaid(page, next);
});

test("SEC-013 SEC-017 a shareable link cannot inject markup or script through its parameters", async ({ page, liveBe }) => {
  const dialogs = failOnDialogs(page);
  const hostile = [
    "&open=%3Cimg%20src%3Dx%20onerror%3Dwindow.__pwned%3D1%3E",
    "&open=javascript:window.__pwned=2",
    "&open=plugins&q=%3Cscript%3Ewindow.__pwned%3D3%3C%2Fscript%3E",
    "&open=" + "a".repeat(3000),
    "&open=../../../etc/passwd",
  ];
  for (const q of hostile) {
    // A legitimate kind (plugins) opens its page; anything else opens the
    // chat. Either way the app is up and nothing was injected.
    await page.goto(`/?ws=${encodeURIComponent(liveBe.wsUrl)}${q}`);
    await expect(page.locator(".app-header, header").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await expect(page.locator("img[onerror]")).toHaveCount(0);
    await notPwned(page, dialogs);
  }
});

/** A raw WebSocket from the app's own origin, with these subprotocols. */
async function tryConnect(page: Page, url: string, protocols: string[] | undefined) {
  return page.evaluate(
    ({ url, protocols }) =>
      new Promise<string>((resolve) => {
        const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
        const t = setTimeout(() => resolve("timeout"), 10_000);
        ws.onopen = () => {
          clearTimeout(t);
          ws.close();
          resolve("open");
        };
        ws.onerror = () => {
          clearTimeout(t);
          resolve("refused");
        };
      }),
    { url, protocols },
  );
}

test("SEC-019 the backend's WebSocket refuses a page with no token or a wrong one", async ({ page, liveBe }) => {
  await page.goto("/");
  expect(await tryConnect(page, liveBe.wsUrl, undefined)).toBe("refused");
  expect(await tryConnect(page, liveBe.wsUrl, ["igni.v1", "igni-token.wrong"])).toBe("refused");
  expect(await tryConnect(page, liveBe.wsUrl, ["igni.v1", `igni-token.${liveBe.token}`])).toBe("open");
});

/** The status of a WebSocket upgrade request sent with these headers. */
function upgradeStatus(wsUrl: string, headers: Record<string, string>): Promise<number> {
  const u = new URL(wsUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: u.hostname,
      port: u.port,
      path: "/",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from("igni-e2e-key-16b").toString("base64") /* 16 bytes, as RFC 6455 wants */,
        ...headers,
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 101);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

test("SEC-021 a page from another origin is refused even with the right token", async ({ liveBe }) => {
  const good = { "Sec-WebSocket-Protocol": `igni.v1, igni-token.${liveBe.token}` };
  expect(await upgradeStatus(liveBe.wsUrl, { ...good, Origin: "https://evil.example" })).toBe(403);
  expect(await upgradeStatus(liveBe.wsUrl, { ...good, Origin: "null" })).toBe(403);
  expect(await upgradeStatus(liveBe.wsUrl, { ...good, Origin: "http://127.0.0.1.evil.example" })).toBe(403);
  expect(await upgradeStatus(liveBe.wsUrl, { ...good, Origin: "http://127.0.0.1:5179" })).toBe(101);
  expect(await upgradeStatus(liveBe.wsUrl, { ...good, Origin: "tauri://localhost" })).toBe(101);
});
