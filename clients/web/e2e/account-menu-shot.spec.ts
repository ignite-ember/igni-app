/**
 * Throwaway capture: the account menu in its new home at the foot of the
 * sidebar, under the chats. Tagged ``@manual`` so it does not run in CI.
 */

import { test, expect } from "./fixtures/embed";
import { signedInStatus } from "./fixtures/backend";

test.use({ viewport: { width: 1200, height: 820 }, deviceScaleFactor: 2 });

test("account menu at the foot of the sidebar", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  backend.onRpc("get_status", () =>
    signedInStatus({
      cloud_email: "dev@acme.com",
      cloud_org: "Acme Engineering",
      cloud_connected: true,
      context_tokens: 84_000,
      max_context: 200_000,
    }),
  );
  backend.onRpc("count_context_tokens", () => ({ tokens: 84_000 }));
  backend.onRpc("get_login_state", () => ({ logged_in: true, email: "dev@acme.com" }));
  backend.onRpc("get_cloud_plan", () => ({ full_name: "Ada Lovelace" }));
  backend.onRpc("get_group_policy", () => ({
    group_id: "g1",
    group_name: "Acme Engineering",
    fetched_at: new Date(0).toISOString(),
    entry_count: 12,
    default_model: "claude-sonnet-5-5",
  }));
  backend.onRpc("list_sessions", () => ({
    sessions: [
      { session_id: "s1", name: "Trace the billing flow end to end" },
      { session_id: "s2", name: "Why is the webhook retrying twice?" },
      { session_id: "s3", name: "Add tests for auth/middleware.py" },
      { session_id: "s4", name: "Dead code under services/billing" },
    ],
  }));

  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toBeVisible();
  const chip = page.locator('.sidebar-footer button.chip[title^="Account"]');
  await expect(chip).toBeVisible();
  await expect(page.locator(".sidebar-footer .chip-sub")).toBeVisible();

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `account-shots/sidebar-${scheme}.png` });
    // Open the menu so the upward popup shows.
    await chip.click();
    await expect(page.locator(".account-menu")).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `account-shots/menu-open-${scheme}.png` });
    await page.keyboard.press("Escape");
  }

  // The folder dropdown under the composer.
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".composer-dock .dock-btn").first().click();
  await expect(page.locator(".dock-menu")).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "account-shots/folder-open-light.png" });
  await page.keyboard.press("Escape");

  const boxes = await page.evaluate(() => {
    const r = (s: string) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
    };
    return {
      folder: r(".composer-dock .dock-btn"),
      session: r(".session-ctx"),
      accountFooter: r(".sidebar-footer"),
      accountChip: r(".sidebar-footer .chip"),
      viewportH: window.innerHeight,
    };
  });
  console.log("DOCKBOXES " + JSON.stringify(boxes));

  // The session + context ring and its combined readout, in the dock.
  await page.locator(".session-ctx").click();
  await expect(page.locator(".ctx-pop")).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "account-shots/ctx-ring-light.png" });
});
