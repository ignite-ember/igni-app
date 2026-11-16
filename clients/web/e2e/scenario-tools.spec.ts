/**
 * Tools and approvals, against a real backend and the scripted model.
 * Scenario ids are docs/ENTERPRISE_TEST_PLAN.md's.
 *
 * The model is told which tool to call (``[[tool ...]]``), so whether a
 * call is asked about is decided by igni's permission rules alone — a
 * command that writes a file is not on any default allow list.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "./fixtures/live-be";
import { assistantSaid, callTool, idle, marker, newChat, open, send, shot } from "./fixtures/chat";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const SHOTS = "scenarios/tools";

function touch(file: string): string {
  return callTool("run_shell_command", { command: `touch ${file}` });
}

test("TOOL-003 Allow once runs the call and the answer arrives", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  await send(page, `${touch("approved-once.txt")} then say ${token}`);

  const card = page.locator(".hitl-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator(".hitl-arg-val").first()).toContainText("touch approved-once.txt");
  await shot(page, SHOTS, "tool-003-asked");
  await card.getByRole("button", { name: "Allow once" }).click();

  await assistantSaid(page, token);
  await expect(page.locator(".tool-card").first()).toBeVisible();
  expect(fs.existsSync(path.join(liveBe.projectDir!, "approved-once.txt"))).toBe(true);
  await idle(page);
  await shot(page, SHOTS, "tool-003-done");
});

test("TOOL-006 Reject does not run the call and is not shown as an error", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  await send(page, `${touch("rejected.txt")} then say ${token}`);

  const card = page.locator(".hitl-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Reject" }).click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });

  await assistantSaid(page, token);
  await idle(page);
  expect(fs.existsSync(path.join(liveBe.projectDir!, "rejected.txt"))).toBe(false);
  await expect(page.locator(".conversation")).not.toContainText(/traceback|unhandled/i);
  await shot(page, SHOTS, "tool-006-rejected");
});

test("TOOL-004 Always allow is not asked again for the same call", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const first = marker();
  await send(page, `${touch("always.txt")} then say ${first}`);
  const card = page.locator(".hitl-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Always allow" }).click();
  await assistantSaid(page, first);
  await idle(page);

  fs.rmSync(path.join(liveBe.projectDir!, "always.txt"));
  const second = marker();
  await send(page, `${touch("always.txt")} then say ${second}`);
  await assistantSaid(page, second);
  await expect(card, "the same call was asked about again").toHaveCount(0);
  expect(fs.existsSync(path.join(liveBe.projectDir!, "always.txt"))).toBe(true);
});

test("TOOL-009 a pending approval survives a reload and can still be answered", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  await send(page, `${touch("after-reload.txt")} then say ${token}`);
  await expect(page.locator(".hitl-card")).toBeVisible({ timeout: 30_000 });

  await page.reload();
  const card = page.locator(".hitl-card");
  await expect(card, "the pending approval was lost on reload").toBeVisible({ timeout: 30_000 });
  await shot(page, SHOTS, "tool-009-after-reload");
  await card.getByRole("button", { name: "Allow once" }).click();
  await assistantSaid(page, token);
  expect(fs.existsSync(path.join(liveBe.projectDir!, "after-reload.txt"))).toBe(true);
});

test("TOOL-010 a pending approval is shown in a second tab and answered there", async ({ page, context, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  const token = marker();
  await send(page, `${touch("second-tab.txt")} then say ${token}`);
  await expect(page.locator(".hitl-card")).toBeVisible({ timeout: 30_000 });
  const session = (await page.locator(".session-chip code").innerText()).trim();

  const tab = await context.newPage();
  await open(tab, liveBe.wsUrl);
  // The second tab opens on the most recent session or offers it in the
  // sidebar; either way the pending call must be answerable from it.
  const chip = (await tab.locator(".session-chip code").innerText()).trim();
  if (chip !== session) {
    await tab.locator(".sidebar, nav").getByText(session.slice(0, 6)).first().click();
  }
  const card = tab.locator(".hitl-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Allow once" }).click();
  await assistantSaid(tab, token);
  // The first tab hears it too: no stale dialog left behind.
  await expect(page.locator(".hitl-card")).toHaveCount(0, { timeout: 15_000 });
});

test("CHAT-007 cancelling while an approval is pending clears it", async ({ page, liveBe }) => {
  await open(page, liveBe.wsUrl);
  await newChat(page);
  await send(page, `${touch("cancelled.txt")} then say done`);
  await expect(page.locator(".hitl-card")).toBeVisible({ timeout: 30_000 });
  // There is no Stop button here: the run's stream ended when it paused, so
  // the composer shows Send. Escape is the app's cancel key ("Stop (Esc)").
  await page.locator(".composer-editable").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".hitl-card")).toHaveCount(0, { timeout: 15_000 });
  await idle(page);
  expect(fs.existsSync(path.join(liveBe.projectDir!, "cancelled.txt"))).toBe(false);
  const token = marker();
  await send(page, `Reply with exactly ${token}.`);
  await assistantSaid(page, token);
});
