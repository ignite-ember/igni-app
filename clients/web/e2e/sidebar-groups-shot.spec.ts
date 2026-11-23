/** Throwaway capture of chats grouped by folder in the sidebar. @manual. */

import { test, expect } from "./fixtures/embed";
import { signedInStatus, type FixtureBackend } from "./fixtures/backend";

// Newest first (the backend sorts by updated_at desc); the group a
// folder's first chat lands in fixes the group's place.
const SESSIONS = [
  { session_id: "s07", name: "Draft the README overhaul", project_dir: "/Users/dev/ai_coding/igni-core", updated_at: 1_700_000_700 },
  { session_id: "s06", name: "Debug the flaky E2E test", project_dir: "/Users/dev/ai_coding/igni-app", updated_at: 1_700_000_600 },
  { session_id: "s05", name: "Air-gap rehearsal checklist", project_dir: "/Users/dev/ai_coding/igni-server", updated_at: 1_700_000_500 },
  { session_id: "s04", name: "Plugins UI redesign", project_dir: "/Users/dev/ai_coding/igni-app", updated_at: 1_700_000_400 },
  { session_id: "s03", name: "Release 0.8.1 notes", project_dir: "/Users/dev/ai_coding/igni-server", updated_at: 1_700_000_300 },
  { session_id: "s02", name: "Refactor the markdown parser", project_dir: "/Users/dev/ai_coding/igni-core", updated_at: 1_700_000_200 },
  { session_id: "s01", name: "Fix the auth token refresh bug", project_dir: "/Users/dev/ai_coding/igni-app", updated_at: 1_700_000_100 },
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

test("sidebar chats grouped by folder", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  mock(backend);
  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".session-group").first()).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "account-shots/sidebar-groups.png" });

  // Collapse the middle group to show the chevron state.
  await page.locator(".session-group-toggle").nth(1).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: "account-shots/sidebar-groups-collapsed.png" });
});
