/**
 * A turn's tools and thinking collapse into one activity group: a
 * progress row that streams in place, opened from the keyboard as well
 * as the pointer, and that stays open while the turn adds to it.
 */

import type { Page } from "@playwright/test";

import { expect, test, type FixtureBackend } from "./fixtures/embed";

async function startTurn(page: Page, backend: FixtureBackend, appUrl: string): Promise<string> {
  await page.goto(appUrl);
  const editor = page.locator(".composer-editable");
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.fill("run the tests");
  await editor.press("Enter");
  await expect.poll(() => backend.received().find((m) => m.type === "user_message")).toBeTruthy();
  const runId = String(backend.received().find((m) => m.type === "user_message")!.id);
  backend.pushEvent({ type: "run_started", id: runId, run_id: runId, parent_run_id: null, agent_name: "igni" });
  return runId;
}

function toolStarted(backend: FixtureBackend, runId: string, friendly: string, args: string) {
  backend.pushEvent({
    type: "tool_started",
    id: runId,
    run_id: runId,
    tool_name: friendly.toLowerCase(),
    friendly_name: friendly,
    args_summary: args,
  });
}

function toolDone(backend: FixtureBackend, runId: string, result: string, isError = false) {
  backend.pushEvent({
    type: "tool_completed",
    id: runId,
    run_id: runId,
    summary: result,
    full_result: result,
    has_markup: false,
    diff_rows: null,
    is_error: isError,
  });
}

test("the progress row follows the turn, and the keyboard opens and closes it", async ({
  page,
  backend,
  appUrl,
}) => {
  const runId = await startTurn(page, backend, appUrl);
  backend.pushEvent({ type: "content_delta", id: runId, text: "Planning the run.", is_thinking: true });
  const head = page.locator(".activity-head");
  await expect(head).toContainText("Thinking…");

  toolStarted(backend, runId, "Bash", "npm test");
  await expect(head).toContainText("npm test");
  await expect(head).toContainText("2 steps");
  await expect(page.locator(".tool-card")).toHaveCount(0);

  await head.focus();
  await page.keyboard.press("Enter");
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".activity-body .tool-card")).toHaveCount(1);

  // A step streamed into the open group lands in it, and it stays open.
  toolDone(backend, runId, "12 passed");
  toolStarted(backend, runId, "Read", "src/theme.css");
  await expect(page.locator(".activity-body .tool-card")).toHaveCount(2);
  await expect(head).toHaveAttribute("aria-expanded", "true");

  await head.focus();
  await page.keyboard.press("Space");
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".tool-card")).toHaveCount(0);

  // Text for the person closes the group; the next tool starts another.
  toolDone(backend, runId, "body { }");
  backend.pushEvent({ type: "content_delta", id: runId, text: "Tests pass.", is_thinking: false });
  toolStarted(backend, runId, "Bash", "npm run lint");
  toolDone(backend, runId, "lint failed", true);
  backend.pushEvent({ type: "content_delta", id: runId, text: "Lint has one error.", is_thinking: false });
  backend.pushEvent({ type: "stream_end", id: runId });
  backend.pushEvent({ type: "run_completed", id: runId, run_id: runId });

  await expect(page.locator(".activity-group")).toHaveCount(2);
  await expect(page.locator(".activity-head").first()).toContainText("Ran 1 command, read 1 file, thought");
  const second = page.locator(".activity-group").nth(1);
  await expect(second).toHaveClass(/failed/);
  await expect(second.locator(".activity-failed")).toHaveText("1 failed");
});
