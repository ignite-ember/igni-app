/**
 * Throwaway: a headed, signed-in app window with a mocked backend, kept
 * open so the account menu's new home in the sidebar can be clicked
 * around. Tagged ``@manual`` so CI never runs it. Run headed:
 *   npx playwright test live-preview.spec.ts --headed --grep @manual --project chromium
 */

import { test, expect } from "./fixtures/embed";
import { signedInStatus } from "./fixtures/backend";

test.use({ viewport: { width: 1280, height: 860 } });

test("live preview — signed in", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  test.setTimeout(3_900_000);

  // A signed-in status carries cloud_email, which is what the sign-in
  // wall is gated on — so the full shell renders, no login needed.
  backend.onRpc("get_status", () =>
    signedInStatus({
      cloud_email: "dev@acme.com",
      cloud_org: "Acme Engineering",
      cloud_connected: true,
      model: "claude-sonnet-5-5",
    }),
  );
  backend.onRpc("get_login_state", () => ({ logged_in: true, email: "dev@acme.com" }));
  backend.onRpc("get_cloud_plan", () => ({ full_name: "Ada Lovelace" }));
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
  await expect(page.locator('.sidebar-footer button.chip[title^="Account"]')).toBeVisible();

  // Hold the window open and interactive for up to an hour.
  await page.waitForTimeout(3_600_000);
});
