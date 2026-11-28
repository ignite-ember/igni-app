/**
 * Find in the conversation grows out of the header's search icon: the
 * pill overlays the chips without moving them, stops short of the
 * sidebar toggle, and passes axe while open with results under it.
 */

import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/embed";
import { signedInStatus, type FixtureBackend } from "./fixtures/backend";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

function mock(be: FixtureBackend) {
  be.onRpc("get_status", () => signedInStatus({ cloud_connected: true, model_configured: true }));
  // A running background process, so the header's chip row has a chip in
  // it: the watcher's chip leaves the header while nothing runs, and the
  // row collapses when it is empty — this spec measures that row.
  be.onRpc("list_background_processes", () => [
    { pid: 8201, cmd: "pnpm run dev --host 127.0.0.1 --port 5179", elapsed_seconds: 47, is_running: true },
  ]);
  be.onRpc("get_chat_history", () => [
    { role: "user", content: "Why does the auth refresh fail?", run_id: "r-1" },
    { role: "assistant", content: "It drops the old auth token first.", run_id: "r-1" },
  ]);
  be.onRpc("search_chat", () => [
    { history_index: 0, role: "user", run_id: "r-1", snippet: "Why does the auth refresh fail?", match_start: 13, match_end: 17, created_at: 0 },
    { history_index: 1, role: "assistant", run_id: "r-1", snippet: "It drops the old auth token first.", match_start: 17, match_end: 21, created_at: 0 },
  ]);
}

for (const scheme of ["light", "dark"] as const) {
  test(`the header's search pill — ${scheme}`, async ({ page, backend, appUrl }) => {
    mock(backend);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(appUrl);
    await expect(page.locator(".msg-assistant").first()).toBeVisible();
    // The chip the row is measured around, once it has arrived.
    await expect(page.locator(".chip-watcher")).toBeVisible();

    const chips = page.locator(".header-status-chips");
    const before = await chips.boundingBox();
    expect(before).not.toBeNull();
    await page.getByRole("button", { name: "Find in conversation" }).click();
    const field = page.getByRole("textbox", { name: "Find in conversation" });
    await expect(field).toBeFocused();
    await field.fill("auth");
    await expect(page.locator(".chat-search-result")).toHaveCount(2);
    await expect(page.locator(".chat-search-status")).toHaveText("1 / 2");

    // Overlaid, not reflowed: the chips have not moved.
    expect(await chips.boundingBox()).toEqual(before);
    // Never over the sidebar toggle.
    const toggle = (await page.locator(".app-header .icon-btn").first().boundingBox())!;
    const pill = (await page.locator(".header-search-pill").boundingBox())!;
    expect(pill.x).toBeGreaterThan(toggle.x + toggle.width);

    const axe = await new AxeBuilder({ page }).include(".header-search").withTags(TAGS).analyze();
    const found = axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(found, found.join("\n")).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(page.locator(".chat-search-bar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Find in conversation" })).toBeFocused();
  });
}
