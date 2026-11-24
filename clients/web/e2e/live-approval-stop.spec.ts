/**
 * A run paused on an approval, against a real backend: Stop, the
 * indicator, the dialog's Escape hint, and a new message sent instead
 * of an answer. F6 / docs/ENTERPRISE_TEST_PLAN.md CHAT-008.
 *
 * The backend ends a paused run's stream before it asks — it sends
 * ``streaming_done``, then ``run_paused`` — so before F6 the window
 * took the run for one finishing: "Finalizing…", Send and no Stop.
 * And a message sent instead of an answer made the backend drop the
 * approvals (igni-core's ``_close_abandoned_pause``) while the dialog
 * stayed on screen, its buttons failing with "Unknown requirement".
 *
 * Each message carries both a script and the words for it: the scripted
 * model (``scripts/e2e/scripted_model.py``) reads ``[[tool ...]]``, a
 * real model behind ``IGNI_LIVE_WS`` reads the sentence. ``touch`` writes
 * a file, which no default rule allows, so the call is asked about.
 */

import { existsSync } from "node:fs";
import * as path from "node:path";

import { expect, type Page } from "@playwright/test";

import { test, whyNoModel, type LiveBe } from "./fixtures/live-be";

const READY = /Message (Ember|igni)/;

test.describe.configure({ mode: "serial", timeout: 180_000 });

// Every test here waits on a model. Declared skip, not silence — see
// `whyNoModel` and `reporters/skips.ts`.
test.beforeEach(() => {
  const why = whyNoModel();
  if (why) test.skip(true, why);
});

/** A token no earlier run can have produced (see `live-chat.spec.ts`). */
function marker(): string {
  return `TKN${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
}

async function connected(page: Page): Promise<void> {
  await expect(page.locator(".composer-editable")).toHaveAttribute("data-placeholder", READY, {
    timeout: 60_000,
  });
}

/** Start from an empty transcript, once the session id has rotated. */
async function newChat(page: Page): Promise<void> {
  const chip = page.locator(".session-ctx-id");
  const before = (await chip.innerText()).trim();
  await page.getByRole("button", { name: /New chat/i }).click();
  await expect(page.locator(".msg-assistant")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => (await chip.innerText()).trim(), { timeout: 30_000 }).not.toBe(before);
}

async function send(page: Page, text: string): Promise<void> {
  const editor = page.locator(".composer-editable");
  await editor.click();
  await editor.fill(text);
  await editor.press("Enter");
}

async function assistantSaid(page: Page, token: string, timeout = 120_000): Promise<void> {
  await expect(page.locator(".msg-assistant").filter({ hasText: token }).first()).toBeVisible({
    timeout,
  });
}

/** Ask for a call that has to be approved, and wait for the dialog. */
async function pauseOnTouch(page: Page, file: string, token: string): Promise<void> {
  const call = JSON.stringify({ command: `touch ${file}` });
  await send(
    page,
    `[[tool run_shell_command ${call}]] Use your shell tool to run \`touch ${file}\`, then say ${token}.`,
  );
  await expect(page.locator(".hitl-card")).toBeVisible({ timeout: 120_000 });
}

function untouched(liveBe: LiveBe, file: string): void {
  // A borrowed backend's project is not ours to look into.
  if (liveBe.projectDir) expect(existsSync(path.join(liveBe.projectDir, file))).toBe(false);
}

const stop = (page: Page) => page.locator(".send-btn.stop");

test("while an approval waits: Stop in place of Send, the indicator says so, and the dialog says what Esc does", { tag: "@needs-model" }, async ({
  page,
  liveBe,
}) => {
  await page.goto(`/?ws=${encodeURIComponent(liveBe.wsUrl)}`);
  await connected(page);
  await newChat(page);
  await pauseOnTouch(page, "waits.txt", marker());

  await expect(stop(page)).toBeVisible();
  await expect(stop(page)).toHaveAttribute("title", "Stop (Esc)");
  await expect(page.locator(".send-btn:not(.stop)")).toHaveCount(0);
  await expect(page.locator(".typing-label")).toHaveText("Waiting for your approval");
  await expect(page.getByText("Finalizing…")).toHaveCount(0);
  await expect(page.locator(".hitl-card .hitl-esc-hint")).toHaveText("Esc rejects all and stops");
  // Still waiting a moment later: nothing about the stream's end moves it on.
  await page.waitForTimeout(1_500);
  await expect(page.locator(".typing-label")).toHaveText("Waiting for your approval");
  await expect(stop(page)).toBeVisible();

  // Leave it answered, so the session's next test starts clean.
  await page.locator(".hitl-card").getByRole("button", { name: "Reject" }).click();
  await expect(page.locator(".hitl-card")).toHaveCount(0, { timeout: 15_000 });
  untouched(liveBe, "waits.txt");
});

test("Stop while an approval waits rejects it and ends the run, with no model turn after", { tag: "@needs-model" }, async ({
  page,
  liveBe,
}) => {
  await page.goto(`/?ws=${encodeURIComponent(liveBe.wsUrl)}`);
  await connected(page);
  await newChat(page);
  const token = marker();
  await pauseOnTouch(page, "stopped.txt", token);

  await stop(page).click();
  await expect(page.locator(".hitl-card")).toHaveCount(0, { timeout: 15_000 });
  await expect(stop(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".typing-indicator")).toHaveCount(0, { timeout: 30_000 });
  await connected(page);
  // The run is over: the reply the rest of the message asked for never comes.
  await page.waitForTimeout(3_000);
  await expect(page.locator(".msg-assistant").filter({ hasText: token })).toHaveCount(0);
  untouched(liveBe, "stopped.txt");

  // And the window takes the next message as a new run.
  const next = marker();
  await send(page, `Reply with exactly ${next}.`);
  await assistantSaid(page, next);
});

test("a new message instead of an answer clears the approval the backend dropped", { tag: "@needs-model" }, async ({
  page,
  liveBe,
}) => {
  await page.goto(`/?ws=${encodeURIComponent(liveBe.wsUrl)}`);
  await connected(page);
  await newChat(page);
  await pauseOnTouch(page, "abandoned.txt", marker());

  const next = marker();
  await send(page, `Reply with exactly ${next}.`);
  await expect(page.locator(".hitl-card"), "the dropped approval is still on screen").toHaveCount(0, {
    timeout: 30_000,
  });
  await assistantSaid(page, next);
  await expect(page.getByText(/Unknown requirement/)).toHaveCount(0);
  await expect(stop(page)).toHaveCount(0, { timeout: 30_000 });
  untouched(liveBe, "abandoned.txt");
});
