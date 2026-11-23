/** Throwaway capture of the chat-list search in the sidebar. @manual. */

import { test, expect } from "./fixtures/embed";
import { signedInStatus, type FixtureBackend } from "./fixtures/backend";

const SESSIONS = [
  { session_id: "a1b2c3d4e5", name: "Fix auth token refresh" },
  { session_id: "b2c3d4e5f6", name: "Refactor the parser" },
  { session_id: "c3d4e5f6a7", name: "Release 0.8.1 notes" },
  { session_id: "d4e5f6a7b8", name: "Plugins UI redesign" },
  { session_id: "e5f6a7b8c9", name: "Air-gap rehearsal" },
];

function mock(be: FixtureBackend) {
  be.onRpc("get_status", () =>
    signedInStatus({ cloud_email: "dev@acme.com", cloud_connected: true, model_configured: true }),
  );
  be.onRpc("get_login_state", () => ({ logged_in: true, email: "dev@acme.com" }));
  be.onRpc("get_cloud_plan", () => ({ full_name: "Ada Lovelace" }));
  be.onRpc("list_sessions", () => SESSIONS);
}

test.use({ viewport: { width: 1300, height: 940 } });

test("sidebar chat search", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  mock(backend);
  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".sidebar-search")).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: "account-shots/sidebar-search.png" });

  // Type a filter.
  await page.locator(".sidebar-search-input").fill("auth");
  await page.waitForTimeout(200);
  await page.screenshot({ path: "account-shots/sidebar-search-filtered.png" });
});
