/** Throwaway capture of the welcome grid (8 cards) and the account menu
 *  identity. @manual. */

import { test, expect } from "./fixtures/embed";
import { signedInStatus, type FixtureBackend } from "./fixtures/backend";

function mock(be: FixtureBackend) {
  be.onRpc("get_status", () =>
    signedInStatus({
      cloud_email: "dmytro.zezyk@vectorbridge.example.com",
      cloud_connected: true,
      cloud_org: "VectorBridge",
      model_configured: true,
      context_tokens: 0,
      max_context: 200_000,
    }),
  );
  be.onRpc("get_login_state", () => ({ logged_in: true, email: "dmytro.zezyk@vectorbridge.example.com" }));
  be.onRpc("get_cloud_plan", () => ({ full_name: "Dmytro Zezyk" }));
}

test.use({ viewport: { width: 1300, height: 940 } });

test("welcome grid + account identity", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  mock(backend);
  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });

  await expect(page.locator(".welcome-cap")).toHaveCount(8);
  await page.waitForTimeout(200);
  await page.screenshot({ path: "account-shots/welcome-8.png" });

  // Open the account menu at the foot of the sidebar.
  await page.locator(".account-chip, .sidebar-footer button").first().click();
  await expect(page.locator(".account-menu")).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: "account-shots/account-identity.png" });
});
