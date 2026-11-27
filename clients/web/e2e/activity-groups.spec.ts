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

test("a marker per step: a tooltip on hover, and a click opens the group at its step", async ({
  page,
  backend,
  appUrl,
}) => {
  const runId = await startTurn(page, backend, appUrl);
  backend.pushEvent({ type: "content_delta", id: runId, text: "Look first.", is_thinking: true });
  toolStarted(backend, runId, "Grep", "--btn- src/");
  toolDone(backend, runId, "3 matches");
  toolStarted(backend, runId, "Read", "src/theme.css");
  toolDone(backend, runId, "body { }");
  toolStarted(backend, runId, "Bash", "npm run lint");
  toolDone(backend, runId, "1 error", true);
  toolStarted(backend, runId, "Bash", "npm test");

  const markers = page.locator(".activity-markers .step-marker");
  await expect(markers).toHaveCount(5);
  await expect(markers.nth(0)).toHaveClass(/glyph-thinking state-done/);
  await expect(markers.nth(3)).toHaveClass(/glyph-command state-failed/);
  await expect(markers.nth(4)).toHaveClass(/state-live/);

  // The failure is red, the reads and searches their own colours, and
  // none of them the same grey.
  const background = (i: number) => markers.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor);
  const colours = await Promise.all([1, 2, 3].map(background));
  expect(new Set(colours).size).toBe(3);
  const [r, g, b] = colours[2].match(/\d+(\.\d+)?/g)!.map(Number);
  expect(r).toBeGreaterThan(g);
  expect(r).toBeGreaterThan(b);

  await page.locator(".step-marker-btn").nth(2).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Read src/theme.css · done");
  await page.locator(".step-marker-btn").nth(3).hover();
  await expect(page.getByRole("tooltip")).toHaveText(/^Bash npm run lint( · \S+)? · failed$/);

  await page.locator(".step-marker-btn").nth(3).click();
  const head = page.locator(".activity-head");
  await expect(head).toHaveAttribute("aria-expanded", "true");
  const step = page.locator('.activity-step[data-step-index="3"]');
  await expect(step).toHaveClass(/flash/);
  await expect(step).toBeInViewport();
  await expect(step).toBeFocused();
  await expect(page.locator(".activity-timeline > .activity-step")).toHaveCount(5);
});

test("the last lines of a streaming thought slide under the markers, and the latest stays", async ({
  page,
  backend,
  appUrl,
}) => {
  const runId = await startTurn(page, backend, appUrl);
  const window = page.locator(".activity-live");
  backend.pushEvent({ type: "content_delta", id: runId, text: "one\ntwo\n", is_thinking: true });
  await expect(window.locator(".live-window-line")).toHaveText(["one", "two"]);
  backend.pushEvent({ type: "content_delta", id: runId, text: "three\nfour", is_thinking: true });
  await expect(window.locator(".live-window-line")).toHaveText(["two", "three", "four"]);
  // However long the thought, the window is three lines tall at most.
  backend.pushEvent({ type: "content_delta", id: runId, text: " and then ".repeat(60), is_thinking: true });
  await expect(window.locator(".live-window-line").last()).toContainText("and then and then");
  const box = await window.boundingBox();
  expect(box!.height).toBeGreaterThan(2 * 18);
  expect(box!.height).toBeLessThanOrEqual(3 * 18 + 1);

  // The thought sits below the line of markers, inside the group.
  const markersBox = await page.locator(".activity-markers").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(markersBox!.y + markersBox!.height);

  // The next step starts: the thought it ended stays in view, quiet.
  toolStarted(backend, runId, "Bash", "npm test");
  await expect(page.locator(".activity-head")).toContainText("npm test");
  await expect(page.locator(".activity-thought-line")).not.toHaveClass(/live/);
  await expect(window.locator(".live-window-line").last()).toContainText("and then and then");

  // Done: the last thought in two lines, and all of it a click away.
  toolDone(backend, runId, "12 passed");
  backend.pushEvent({ type: "content_delta", id: runId, text: "Tests pass.", is_thinking: false });
  backend.pushEvent({ type: "stream_end", id: runId });
  backend.pushEvent({ type: "run_completed", id: runId, run_id: runId });
  const toggle = page.getByRole("button", { name: "All thinking" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const done = await window.boundingBox();
  expect(done!.height).toBeLessThanOrEqual(2 * 18 + 1);
  await toggle.click();
  await expect(page.locator(".activity-thoughts-full")).toContainText("one\ntwo\nthree\nfour");
  await expect(page.locator(".activity-head")).toHaveAttribute("aria-expanded", "false");
});

test("under reduced motion the running marker's ring holds still", async ({ page, backend, appUrl }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const runId = await startTurn(page, backend, appUrl);
  toolStarted(backend, runId, "Bash", "npm test");
  const live = page.locator(".activity-markers .step-marker.state-live");
  await expect(live).toHaveCount(1);
  expect(await live.evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("none");
  // Still there, only still.
  expect(await live.evaluate((el) => getComputedStyle(el, "::after").borderTopStyle)).toBe("solid");
  const dot = page.locator(".activity-head .activity-live-dot");
  expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await live.evaluate((el) => getComputedStyle(el, "::after").animationName)).toBe("step-pulse");
  expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe("pulse-dot");
});

test("a long run keeps every marker on the row while the width holds them", async ({ page, backend, appUrl }) => {
  const runId = await startTurn(page, backend, appUrl);
  for (let i = 0; i < 22; i++) {
    toolStarted(backend, runId, "Bash", `step ${i}`);
    toolDone(backend, runId, "ok", i === 9);
  }
  backend.pushEvent({ type: "content_delta", id: runId, text: "Done.", is_thinking: false });
  backend.pushEvent({ type: "stream_end", id: runId });
  backend.pushEvent({ type: "run_completed", id: runId, run_id: runId });
  await expect(page.locator(".activity-markers .step-marker")).toHaveCount(22);
  await expect(page.locator(".activity-more")).toHaveCount(0);
  await expect(page.locator(".activity-markers .step-marker.state-failed")).toHaveCount(1);
  await expect(page.locator(".activity-chips")).toContainText("21commands");
  await expect(page.locator(".activity-failed")).toHaveText("1 failed");

  // A narrow window folds the earliest into "+k", and only then.
  await page.setViewportSize({ width: 560, height: 800 });
  await expect(page.locator(".activity-more")).toBeVisible();
  const shown = await page.locator(".activity-markers .step-marker").count();
  await expect(page.locator(".activity-more")).toHaveText(`+${22 - shown}`);
  const strip = await page.locator(".activity-markers").boundingBox();
  const last = await page.locator(".activity-markers .step-marker-slot").last().boundingBox();
  expect(last!.x + last!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 0.5);
});
