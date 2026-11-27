/**
 * Cross-restart orphan with real stdout — the proper demo.
 *
 * The previous orphan demo showed the "no buffered output"
 * placeholder because the test harness used ``sleep`` (no
 * output). This one uses a process whose per-pid log file was
 * pre-seeded with real-looking dev-server output — the orphan's
 * ``read()`` should return that content verbatim.
 */
import { test, expect } from "./fixtures/live-be";

test.use({ orphanScenario: "dev_server" });

test("orphan tail pane shows real stdout from per-pid log", async ({
  page,
  liveWsUrl,
}) => {
  await page.goto(`/?ws=${encodeURIComponent(liveWsUrl)}`);
  await expect(page.locator(".composer-editable")).toHaveAttribute(
    "data-placeholder",
    /Message (Ember|igni)/,
    { timeout: 30_000 },
  );

  // The header chip should appear (1 running).
  await expect(page.locator(".chip-watcher")).toBeVisible({ timeout: 5_000 });

  // Click the chip → watcher opens with the orphan.
  await page.locator(".chip-watcher").click();
  await expect(page.locator(".watcher-row")).toHaveCount(1);

  // Click the row → tail pane loads from the per-pid log file.
  await page.locator(".watcher-row").click();
  await expect(page.locator(".watcher-log")).toContainText(
    "listening on http://127.0.0.1:3000",
    { timeout: 5_000 },
  );

  await page.screenshot({ path: "test-results/watcher-orphan-with-logs.png" });
});
