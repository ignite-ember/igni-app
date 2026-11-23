/**
 * Throwaway capture of the notifications panel, populated with a few
 * example notices so the shape of the feature is legible. @manual.
 */

import { test, expect } from "./fixtures/embed";
import { signedInStatus, type FixtureBackend } from "./fixtures/backend";

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

const NOTIFS = [
  {
    id: "n1",
    origin: "local",
    source: "igni",
    kind: "approval",
    title: "A run is waiting for your approval",
    body: "igni wants to run `npm test` in igni-app. Open the session to approve or deny.",
    actor: "",
    target: { page: "session", params: { session_id: "ebbc7eff" } },
    created_at: ago(2),
    read: false,
  },
  {
    id: "n2",
    origin: "server",
    source: "Code review",
    kind: "review",
    title: "3 findings on feat/account-menu-in-sidebar",
    body: "1 correctness issue, 2 nits. Open to review and apply the fixes.",
    actor: "Code Review",
    target: { page: "extension", params: { id: "reviewer" } },
    created_at: ago(18),
    read: false,
    org_name: "Acme Engineering",
  },
  {
    id: "n3",
    origin: "server",
    source: "CI",
    kind: "ci",
    title: "CI passed on main",
    body: "All 20 checks green for commit 9f04153b.",
    actor: "CI",
    target: { page: "extension", params: { id: "ci" } },
    created_at: ago(63),
    read: false,
    org_name: "Acme Engineering",
  },
  {
    id: "n4",
    origin: "server",
    source: "Chat",
    kind: "mention",
    title: "Ada Lovelace mentioned you",
    body: "“Can you take a look at the gateway retry logic before the release?”",
    actor: "Ada Lovelace",
    target: { page: "extension", params: { id: "chat" } },
    created_at: ago(190),
    read: true,
    org_name: "Acme Engineering",
  },
  {
    id: "n5",
    origin: "local",
    source: "igni",
    kind: "done",
    title: "Background workflow finished",
    body: "“review-changes” completed — 2 issues found across 9 files.",
    actor: "",
    target: { page: "session", params: { session_id: "a1f9c2e4" } },
    created_at: ago(1500),
    read: true,
  },
];

const COUNTS = { unread: 3, by_source: { "Code review": 1, CI: 1, igni: 1 } };

function mock(be: FixtureBackend) {
  be.onRpc("get_status", () =>
    signedInStatus({
      cloud_email: "dev@acme.com",
      cloud_org: "Acme Engineering",
      cloud_connected: true,
      context_tokens: 84_000,
      max_context: 200_000,
    }),
  );
  be.onRpc("get_login_state", () => ({ logged_in: true, email: "dev@acme.com" }));
  be.onRpc("get_cloud_plan", () => ({ full_name: "Ada Lovelace" }));
  be.onRpc("list_sessions", () => ({ sessions: [{ session_id: "s1", name: "Trace the billing flow" }] }));
  be.onRpc("notifications_counts", () => COUNTS);
  be.onRpc("notifications_list", () => ({ notifications: NOTIFS, counts: COUNTS }));
  be.onRpc("notifications_mark_read", () => ({ counts: COUNTS }));
}

test.use({ viewport: { width: 1280, height: 900 } });

test("notifications panel with examples", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  mock(backend);
  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.locator(".notify-panel")).toBeVisible();
  await expect(page.locator(".notify-row")).toHaveCount(5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "account-shots/notifications.png" });
});
