/**
 * The terminal in a real browser, against the fixture backend: the
 * header's button opens it in the dock, real xterm draws what igni
 * pushes, what is typed goes back as ``terminal_input``, and it shares
 * the dock with the files. The shell itself is igni-core's and tested
 * there; here the fixture plays it.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test, type FixtureBackend } from "./fixtures/embed";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

async function open(page: Page, appUrl: string) {
  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toHaveAttribute("data-placeholder", /Message (Ember|igni)/);
}

function terminalCalls(backend: FixtureBackend, method: string) {
  return backend
    .received()
    .filter((m) => m.type === "rpc_request" && m.method === method)
    .map((m) => m.args as Record<string, unknown>);
}

test.describe("the terminal", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("opens from the header, shows igni's output and sends what is typed", async ({ page, backend, appUrl }) => {
    // Each open is a new shell with its own id.
    let opened = 0;
    backend.onRpc("terminal_open", () => ({ terminal_id: `t${++opened}`, shell: "/bin/zsh", cwd: "/tmp/project" }));
    backend.onRpc("terminal_input", (args) => ({ terminal_id: args.terminal_id }));
    backend.onRpc("terminal_resize", (args) => ({ terminal_id: args.terminal_id }));
    backend.onRpc("terminal_close", (args) => ({ terminal_id: args.terminal_id }));
    const output = (terminal_id: string, data: string) =>
      backend.pushEvent({ type: "push_notification", channel: "terminal_output", payload: { terminal_id, data } });
    await open(page, appUrl);

    const button = page.getByRole("button", { name: "Terminal", exact: true });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const dock = page.getByRole("complementary", { name: "Terminal" });
    const panel = dock.getByRole("tabpanel");
    await expect(panel.locator(".xterm")).toBeVisible();
    await expect(dock.getByRole("tab")).toHaveText(["zsh"]);

    await expect.poll(() => terminalCalls(backend, "terminal_open").length).toBe(1);
    const size = terminalCalls(backend, "terminal_open")[0];
    expect(size.cols).toBeGreaterThan(10);
    expect(size.rows).toBeGreaterThan(3);

    output("other", "not-this-window ");
    output("t1", "igni-prompt$ ");
    await expect(panel.locator(".xterm-rows")).toContainText("igni-prompt$");

    await page.keyboard.type("ls");
    await expect.poll(() => terminalCalls(backend, "terminal_input").map((a) => a.data).join("")).toBe("ls");

    // Escape is the shell's: no cancel frame goes to igni.
    await page.keyboard.press("Escape");
    await expect.poll(() => terminalCalls(backend, "terminal_input").at(-1)?.data).toBe("\x1b");
    expect(backend.received().filter((m) => m.type === "cancel")).toEqual([]);

    // The window with the terminal open has nothing for axe. (Scanned
    // before the files open: their tree has findings of its own.)
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const found = results.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(found, found.join("\n")).toEqual([]);

    // A second tab: its own shell, its own screen.
    await dock.getByRole("button", { name: "New terminal" }).click();
    await expect(dock.getByRole("tab")).toHaveText(["zsh", "zsh 2"]);
    await expect.poll(() => terminalCalls(backend, "terminal_open").length).toBe(2);
    output("t2", "second-shell$ ");
    await expect(panel.locator(".xterm-rows")).toContainText("second-shell$");
    await expect(panel.locator(".xterm-rows")).not.toContainText("igni-prompt$");

    // Hidden, the shells run on and take output; shown, both tabs are back.
    await button.click();
    await expect(page.getByRole("complementary")).toHaveCount(0);
    output("t1", "while-hidden ");
    await button.click();
    await expect(dock.getByRole("tab")).toHaveText(["zsh", "zsh 2"]);
    await dock.getByRole("tab", { name: "zsh", exact: true }).click();
    await expect(panel.locator(".xterm-rows")).toContainText("igni-prompt$ while-hidden");
    expect(terminalCalls(backend, "terminal_close")).toEqual([]);
    expect(terminalCalls(backend, "terminal_open")).toHaveLength(2);

    // The files open above it, and the terminal keeps its shells.
    await page.getByRole("button", { name: "Files", exact: true }).click();
    const both = page.getByRole("complementary", { name: "Files and terminal" });
    await expect(both.locator(".dock-split")).toBeVisible();
    await expect(both.locator(".xterm-rows")).toContainText("igni-prompt$");
    await expect(both.locator(".xterm-rows")).not.toContainText("not-this-window");

    // Closing a tab closes its shell, and only that one.
    await both.getByRole("button", { name: "Close terminal zsh 2" }).click();
    await expect.poll(() => terminalCalls(backend, "terminal_close")).toEqual([{ terminal_id: "t2" }]);
    await expect(both.getByRole("tab")).toHaveText(["zsh"]);
  });

  test("shows a refusal plainly", async ({ page, backend, appUrl }) => {
    backend.onRpc("terminal_open", () => {
      throw new Error("terminal_open: the organisation turned the terminal off");
    });
    await open(page, appUrl);
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".terminal-notice")).toContainText("the organisation turned the terminal off");
  });
});
