/**
 * Chat, streaming and resilience, against a real backend and the scripted
 * model. Scenario ids are docs/ENTERPRISE_TEST_PLAN.md's.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "./fixtures/live-be";
import {
  assistantSaid,
  callTool,
  connected,
  idle,
  marker,
  newChat,
  open,
  send,
  shot,
} from "./fixtures/chat";

test.describe.configure({ mode: "serial", timeout: 150_000 });

const SHOTS = "scenarios/chat";
const stopButton = (page: import("@playwright/test").Page) =>
  page.locator(".send-btn.stop");

test("CHAT-002 a reply streams in pieces and the composer comes back", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  await send(page, "[[slow 150]] [[lines 30]]");
  // Mid-stream: an early line is on screen while the last is not yet.
  await assistantSaid(page, "Line 3 of the scripted reply.");
  await expect(stopButton(page)).toBeVisible();
  await expect(page.locator(".msg-assistant").filter({ hasText: "Line 30 of" })).toHaveCount(0);
  await shot(page, SHOTS, "chat-002-streaming");
  await assistantSaid(page, "Line 30 of the scripted reply.");
  await idle(page);
});

test("CHAT-003 Stop before the first token ends the run", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  await send(page, "[[hang]]");
  await expect(stopButton(page)).toBeVisible({ timeout: 30_000 });
  await stopButton(page).click();
  await idle(page, 30_000);
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
});

test("CHAT-005 Stop mid-stream keeps what arrived and stops the rest", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  await send(page, "[[slow 300]] [[lines 200]]");
  await assistantSaid(page, "Line 2 of the scripted reply.");
  await stopButton(page).click();
  await idle(page, 30_000);
  await page.waitForTimeout(2_000);
  await expect(page.locator(".conversation")).not.toContainText("Line 200 of");
  await shot(page, SHOTS, "chat-005-stopped");
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
});

test("CHAT-004 Stop while a tool runs ends the run long before the tool would", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  await send(page, `${callTool("run_shell_command", { command: "sleep 40 && touch slept.txt", timeout: 60 })} then say done`);
  const card = page.locator(".hitl-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Allow once" }).click();
  await expect(stopButton(page)).toBeVisible({ timeout: 15_000 });
  const started = Date.now();
  await stopButton(page).click();
  await idle(page, 30_000);
  expect(Date.now() - started).toBeLessThan(30_000);
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
  expect(fs.existsSync(path.join(liveBe.projectDir!, "slept.txt"))).toBe(false);
});

test("CHAT-018 a 3,000-line reply renders, the page stays responsive, and the next turn is in view", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  await send(page, "[[lines 3000]]");
  await assistantSaid(page, "Line 3000 of the scripted reply.", 90_000);
  await idle(page);
  // A frame within a second: the main thread is not wedged by the transcript.
  const ms = await page.evaluate(
    () => new Promise<number>((r) => { const t = performance.now(); requestAnimationFrame(() => r(performance.now() - t)); }),
  );
  expect(ms).toBeLessThan(1_000);
  // The next message and its answer are where the person can see them. The
  // transcript is virtualised, so "not in view" is "not in the DOM": this
  // failed before the composer brought the list to its end on send.
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
  await expect(page.locator(".msg-assistant").filter({ hasText: token }).first()).toBeInViewport();
  await shot(page, SHOTS, "chat-018-long");
});

test("CHAT-031 the model provider failing is reported and the next turn works", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  await send(page, "[[status 500]]");
  await expect(
    page.locator(".conversation").getByText(/error|failed|500/i).first(),
    "a provider failure left no trace in the conversation",
  ).toBeVisible({ timeout: 90_000 });
  await idle(page, 90_000);
  await shot(page, SHOTS, "chat-031-provider-error");
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
});

test("CHAT-020 the backend crashing mid-answer is shown, and the app recovers when it is back", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  // The answer has to be long enough that the crash lands in the middle of
  // it, and short enough that the *recovery* turn finishes inside this
  // test's timeout. The backend quotes the interrupted question verbatim in
  // its recap ("The user had asked: '...'"), and the scripted model reads
  // the directives out of that quote — so the recovery turn answers with
  // the same number of lines at the same pace. 20 lines at 150 ms is about
  // 18 seconds: long enough to be interrupted, short enough to be answered
  // again after the backend is back.
  await send(page, "[[slow 150]] [[lines 20]]");
  await assistantSaid(page, "Line 2 of the scripted reply.");
  await liveBe.kill();
  // The app says it lost the backend rather than looking busy forever.
  await expect(page.locator(".composer-editable")).toHaveAttribute(
    "data-placeholder",
    /Connecting to backend/,
    { timeout: 30_000 },
  );
  await shot(page, SHOTS, "chat-020-backend-gone");
  await liveBe.restart();
  await connected(page, 60_000);
  await idle(page, 60_000);
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
  await shot(page, SHOTS, "chat-020-recovered");
});

test("CHAT-022 a dropped connection reconnects by itself", async ({ page, liveBe }) => {
  let sever: (() => void) | null = null;
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    sever = () => {
      server.close();
      ws.close();
    };
  });
  await open(page, liveBe.wsUrl);
  await newChat(page);
  expect(sever).not.toBeNull();
  sever!();
  await expect(page.locator(".composer-editable")).toHaveAttribute(
    "data-placeholder",
    /Connecting to backend/,
    { timeout: 15_000 },
  );
  await connected(page, 60_000);
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
});

test("CHAT-027 two tabs of one browser on one backend both work", async ({ page, context, liveBe }) => {
  // KNOWN BUG, kept red-on-fix rather than skipped: every tab of a browser
  // profile takes the same client id from localStorage
  // (`clientState.ts`, `ember-code:client-id`), and the backend keeps one
  // window model per client id. The second tab lands on the first tab's
  // session, its "+ New chat" does not give it one of its own, its socket
  // is displaced, and a message sent there gets no answer. `test.fail()`
  // makes this pass while the bug is present and fail the day it is fixed,
  // so the fix cannot go unnoticed. docs/ENTERPRISE_TEST_PLAN.md CHAT-027.
  test.fail();
  test.setTimeout(60_000);
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const other = await context.newPage();
  await open(other, liveBe.wsUrl);
  await newChat(other);
  const a = (await page.locator(".session-chip code").innerText()).trim();
  const b = (await other.locator(".session-chip code").innerText()).trim();
  expect(b, "the second tab is on the first tab's session").not.toBe(a);

  const ta = marker();
  const tb = marker();
  await send(page, `Reply with exactly ${ta}.`);
  await send(other, `Reply with exactly ${tb}.`);
  await assistantSaid(page, ta, 20_000);
  await assistantSaid(other, tb, 20_000);
  await expect(page.locator(".conversation")).not.toContainText(tb);
  await expect(other.locator(".conversation")).not.toContainText(ta);
});

test("CHAT-012 messages typed during a run are queued and all answered, in order", async ({ page, liveBe }) => {
  // The igni-core bug this row was kept red-on-fix for is fixed: a message
  // queued during a run is the next turn when no tool call took it
  // (igni-core cefccc4f — "A message queued during a run is the next turn
  // when no tool call took it"). The backend drains what is left in the
  // queue when the run ends (`backend/message_dispatcher.py`,
  // `_run_queued`), so the messages run in order, each as its own turn.
  // The `test.fail()` marker that held this row red is gone with the bug.
  // docs/ENTERPRISE_TEST_PLAN.md CHAT-012, CHAT-014.
  test.setTimeout(90_000);
  await open(page, liveBe.wsUrl);
  await newChat(page);
  await send(page, "[[slow 200]] [[lines 15]]");
  await assistantSaid(page, "Line 1 of the scripted reply.");
  const tokens = [marker(), marker(), marker()];
  for (const t of tokens) await send(page, `Reply with exactly ${t}.`);
  await expect(page.locator(".conversation")).toContainText(/Queued/i, { timeout: 15_000 });
  for (const t of tokens) await assistantSaid(page, t, 30_000);
  await idle(page);
  const order = await page.locator(".msg-assistant").allInnerTexts();
  const at = tokens.map((t) => order.findIndex((txt) => txt.includes(t)));
  expect(at, `answers out of order: ${at}`).toEqual([...at].sort((x, y) => x - y));
  await shot(page, SHOTS, "chat-012-queue-drained");
});

test("SESS-018 a conversation is still there after a reload", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
  const session = (await page.locator(".session-chip code").innerText()).trim();
  await page.reload();
  await connected(page);
  await expect(page.locator(".session-chip code")).toHaveText(session, { timeout: 15_000 });
  await assistantSaid(page, token, 15_000);
});

test("SESS-019 a session of 25 turns reloads complete", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const tokens: string[] = [];
  for (let i = 0; i < 25; i++) {
    const t = marker();
    tokens.push(t);
    await send(page, `Reply with exactly ${t}.`);
    await assistantSaid(page, t);
    await idle(page);
  }
  await page.reload();
  await connected(page);
  // The transcript is virtualised: the newest turn is on screen, and the
  // oldest is there once scrolled to.
  await expect(page.locator(".conversation")).toContainText(tokens[24], { timeout: 15_000 });
  await expect(async () => {
    await page.locator(".conversation").evaluate((el) => el.scrollTo({ top: 0 }));
    await expect(page.locator(".conversation")).toContainText(tokens[0], { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
});
