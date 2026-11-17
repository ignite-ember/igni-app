/**
 * The real window, checked by axe — not only the `?demo=` sandboxes.
 *
 * `app-accessibility.spec.ts` scans seventeen sandbox screens, which mount
 * pieces of the chat without the shell around them. The shell itself was
 * never scanned, and had the violations that follow from that: a composer
 * with no accessible name, a slash menu that scrolls but cannot be reached
 * by keyboard, no `<main>` and no `<h1>`, and a second banner landmark
 * when the notifications drawer opened (R683). This scans the window the
 * fixture backend serves — the same App a person gets — in both themes,
 * at rest, with the slash menu and the notifications drawer open, and on
 * the Plugins, MCPs and Extensions pages.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { runSlashCommand } from "./fixtures/composer";
import { expect, test } from "./fixtures/embed";

/** WCAG 2.0/2.1 A and AA, plus axe's best-practice set. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function violations(page: Page): Promise<string[]> {
  // A drawer that slides and fades in measures as low contrast mid-flight.
  // Endless ones (a spinner) never finish, so only the finite are awaited.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const measured = results.passes.reduce((n, p) => n + p.nodes.length, 0);
  expect(measured, "axe checked almost nothing").toBeGreaterThan(20);
  return results.violations.map(
    (v) =>
      `${v.id} (${v.impact}, ${v.nodes.length}×): ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")}\n      ${n.failureSummary?.split("\n")[1] ?? ""}`)
        .join("\n"),
  );
}

/**
 * Answer the app's own ``/<action>`` command frame with the
 * ``command_result`` that opens its page, as the backend does. The
 * fixture backend records command frames but does not run them.
 */
async function answerPageCommands(page: Page) {
  await page.addInitScript(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      try {
        const m = JSON.parse(String(data));
        const action = /^\/(hooks|watcher|help)$/.exec(String(m?.text ?? "").trim())?.[1];
        if (m?.type === "command" && action) {
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ type: "command_result", id: m.id, kind: "action", content: "", action }),
              }),
            );
          }, 0);
        }
      } catch {
        /* not JSON */
      }
      return send.call(this, data);
    };
  });
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`the window — ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: theme });

    async function open(page: Page, appUrl: string) {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("ember:theme", t);
        } catch {
          /* the theme then follows colorScheme */
        }
      }, theme);
      await page.goto(appUrl);
      await expect(page.locator(".composer-editable")).toHaveAttribute(
        "data-placeholder",
        /Message (Ember|igni)/,
      );
    }

    test("the chat has no axe violations", async ({ page, appUrl }) => {
      await open(page, appUrl);
      const found = await violations(page);
      expect(found, found.join("\n\n")).toEqual([]);
    });

    test("a conversation has no axe violations", async ({ page, appUrl }) => {
      // The welcome screen carries the page's <h1>; a transcript did not.
      await open(page, appUrl);
      await page.locator(".composer-editable").click();
      await page.keyboard.type("hello there");
      await page.keyboard.press("Enter");
      await expect(page.locator(".conversation").getByText("hello there")).toBeVisible();
      const found = await violations(page);
      expect(found, found.join("\n\n")).toEqual([]);
    });

    test("the slash menu has no axe violations", async ({ page, appUrl }) => {
      await open(page, appUrl);
      await page.locator(".composer-editable").click();
      await page.keyboard.type("/");
      await expect(page.locator(".popup-menu").first()).toBeVisible();
      const found = await violations(page);
      expect(found, found.join("\n\n")).toEqual([]);
    });

    test("the slash menu keeps the highlighted command in view", async ({ page, appUrl }) => {
      // Focus stays in the composer and the arrows move the highlight;
      // past the eighth row it went below the menu's visible area and
      // the menu never scrolled (R683).
      await open(page, appUrl);
      const editor = page.locator(".composer-editable");
      await editor.click();
      await page.keyboard.type("/");
      const menu = page.locator(".popup-menu").first();
      await expect(menu).toBeVisible();
      for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
      const active = menu.locator(".popup-item.active");
      await expect(active).toBeInViewport();
      const inside = await menu.evaluate((m) => {
        const row = m.querySelector(".popup-item.active")!.getBoundingClientRect();
        const box = m.getBoundingClientRect();
        return row.top >= box.top - 1 && row.bottom <= box.bottom + 1;
      });
      expect(inside, "the highlighted row is inside the menu's visible area").toBe(true);
      await expect(editor).toHaveAttribute("aria-activedescendant", (await active.getAttribute("id"))!);
    });

    for (const label of ["Plugins", "MCPs", "Extensions"]) {
      test(`the ${label} page has no axe violations`, async ({ page, appUrl }) => {
        // The conversation, which holds the chat's <h1>, is hidden under
        // a page: a page titled with an <h2> left no <h1> (R683).
        await open(page, appUrl);
        await page.locator(".sidebar").getByRole("button", { name: label, exact: true }).first().click();
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        const found = await violations(page);
        expect(found, found.join("\n\n")).toEqual([]);
      });
    }

    test("the Hooks page, with a background hook, has no axe violations", async ({ page, backend, appUrl }) => {
      // The 'background' tag was --success on --bg-raised at 11px:
      // 4.41:1 light, 4.16:1 dark (R683).
      backend.onRpc("get_hooks_details", () => [
        { event: "Stop", type: "command", command: ".igni/hooks/on-stop.sh", url: "", matcher: "",
          timeout_ms: 10000, background: true, headers: {} },
        { event: "PreToolUse", type: "command", command: ".igni/hooks/guard.sh", url: "", matcher: "Bash",
          timeout_ms: 5000, background: false, headers: {} },
      ]);
      await answerPageCommands(page);
      await open(page, appUrl);
      await runSlashCommand(page, "/hooks", page.locator(".hooks-tag.tone-good").first());
      const found = await violations(page);
      expect(found, found.join("\n\n")).toEqual([]);
    });

    test("the Watcher page, with a stopped process, has no axe violations", async ({ page, backend, appUrl }) => {
      // A stopped row's 'exit -15' was faded to 2.8:1, and the row's
      // accessible name left out the visible exit text (R683).
      backend.onRpc("list_background_processes", () => [
        { pid: 8201, cmd: "sleep 901", elapsed_seconds: 47, is_running: true },
        { pid: 8512, cmd: "python3 -m http.server 19418", elapsed_seconds: 8, is_running: false, exit_code: -15 },
      ]);
      await answerPageCommands(page);
      await open(page, appUrl);
      await runSlashCommand(page, "/watcher", page.locator(".watcher-row--stopped"));
      const found = await violations(page);
      expect(found, found.join("\n\n")).toEqual([]);
    });

    test("the Help page has no axe violations", async ({ page, appUrl }) => {
      // Its groups were <h3> under the page's <h1> (R683).
      await answerPageCommands(page);
      await open(page, appUrl);
      await runSlashCommand(page, "/help", page.locator(".help-group").first());
      const found = await violations(page);
      expect(found, found.join("\n\n")).toEqual([]);
    });

    test("Escape closes the account menu and returns focus to the chip", async ({ page, appUrl }) => {
      await open(page, appUrl);
      const chip = page.locator('button.chip[title^="Account"]');
      await chip.click();
      await expect(page.locator(".account-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".account-menu")).toHaveCount(0);
      await expect(chip).toBeFocused();
    });

    test("the notifications drawer has no axe violations", async ({ page, appUrl }) => {
      await open(page, appUrl);
      await page.getByRole("button", { name: "Notifications" }).first().click();
      await expect(page.locator("aside, [role=dialog]").filter({ hasText: /otification/ }).first()).toBeVisible();
      const found = await violations(page);
      expect(found, found.join("\n\n")).toEqual([]);
    });
  });
}
