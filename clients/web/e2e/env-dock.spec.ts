/**
 * Throwaway captures of the composer dock's environment control:
 * switchable (the group offers both sides) and read-only (it does not,
 * but the person still sees which side was chosen). Also shows the
 * neutral Execute button. Tagged @manual so CI never runs it.
 */

import { test, expect } from "./fixtures/embed";
import { signedInStatus, type FixtureBackend } from "./fixtures/backend";

const SNAP = (overrides: Record<string, unknown>) => ({
  side: "local",
  state: "local",
  reason: null,
  detail: null,
  credential_warning: false,
  mode: "local_and_cloud",
  cloud: "available",
  cloud_reason: null,
  switch_visible: true,
  chip_visible: true,
  can_use_local: true,
  can_use_cloud: true,
  backend_key: "local",
  local_activity: { runs: 0, approvals: 0 },
  notice: null,
  vm: null,
  group_name: "Engineering",
  retry_in_ms: null,
  ...overrides,
});

function mockRpcs(backend: FixtureBackend) {
  backend.onRpc("get_status", () =>
    signedInStatus({ cloud_email: "dev@acme.com", cloud_connected: true, context_tokens: 84_000, max_context: 200_000 }),
  );
  backend.onRpc("get_login_state", () => ({ logged_in: true, email: "dev@acme.com" }));
  backend.onRpc("get_cloud_plan", () => ({ full_name: "Ada Lovelace" }));
  backend.onRpc("list_sessions", () => ({ sessions: [{ session_id: "s1", name: "Trace the billing flow" }] }));
}

async function boot(page: import("@playwright/test").Page, snap: Record<string, unknown>) {
  await page.addInitScript((s) => {
    (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
      core: { invoke: async (cmd: string) => (cmd === "backend_state" ? s : null) },
    };
  }, snap);
}

test.use({ viewport: { width: 1280, height: 860 } });

test("environment — switchable", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  mockRpcs(backend);
  await boot(page, SNAP({ switch_visible: true, mode: "local_and_cloud", side: "local" }));
  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".composer-editable").click();
  await page.keyboard.type("hello");
  await page.getByTitle("Where igni runs").click();
  await expect(page.getByRole("radiogroup", { name: "Where igni runs" })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "account-shots/env-switchable.png" });
});

test("environment — read-only", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  mockRpcs(backend);
  await boot(page, SNAP({ switch_visible: false, chip_visible: false, mode: "local", side: "local" }));
  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".composer-editable").click();
  await page.keyboard.type("hello");
  await expect(page.locator(".dock-static")).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "account-shots/env-readonly.png" });

  // The renamed permission-mode menu.
  await page.locator(".composer-mode").click();
  await expect(page.locator(".send-mode-menu")).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "account-shots/mode-menu.png" });
});
