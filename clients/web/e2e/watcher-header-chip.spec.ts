/**
 * Screenshot of the header's watcher status chip rendering when there's
 * at least one running background process. Drives a live BE
 * pre-seeded with an orphan row. The seeding is the fixture's job now
 * (``orphanScenario``), so this runs with no setup — it used to need a
 * script run by hand, a backend started by hand, and an environment
 * variable. F129.
 */
import { test, expect } from "./fixtures/live-be";

test.use({ orphanScenario: "sleep" });

test("header shows the watcher chip when processes are running", async ({
  page,
  liveWsUrl,
}) => {
  await page.goto(`/?ws=${encodeURIComponent(liveWsUrl)}`);
  await expect(page.locator(".composer-editable")).toHaveAttribute(
    "data-placeholder",
    /Message (Ember|igni)/,
    { timeout: 30_000 },
  );

  // The chip is hidden when count === 0; visible otherwise. We
  // seeded one orphan before starting the BE, so the seed RPC
  // should report it back in the running list and the chip
  // appears, in the header's status group.
  const chip = page.locator(".app-header .header-status-chips .chip-watcher");
  await expect(chip).toBeVisible({ timeout: 5_000 });
  await expect(chip).toHaveAccessibleName("Watcher 1 background process running");
  await expect(page.locator(".statusline .chip-watcher")).toHaveCount(0);

  // Screenshot the header.
  const header = page.locator(".app-header");
  const box = await header.boundingBox();
  if (box) {
    await page.screenshot({
      path: "test-results/watcher-header-chip.png",
      clip: {
        x: 0,
        y: Math.max(0, box.y - 20),
        width: page.viewportSize()!.width,
        height: box.height + 40,
      },
    });
  } else {
    await page.screenshot({ path: "test-results/watcher-header-chip.png" });
  }

  // Click the chip — the panel opens.
  await chip.click();
  await expect(page.locator(".page")).toBeVisible();
  await page.screenshot({ path: "test-results/watcher-header-chip-opened.png" });
});
