/**
 * The steps every scenario spec against a real backend repeats: open the
 * app on the fixture's backend, wait for it to connect, start from an empty
 * transcript, send, and wait for the scripted model's answer.
 *
 * The scripted model (``scripts/e2e/scripted_model.py``) answers from the
 * message itself, so a spec says what the model will do in what it types:
 * ``[[tool NAME {args}]]``, ``[[slow MS]]``, ``[[lines N]]``,
 * ``[[b64 ...]]``, ``[[status CODE]]``, ``[[hang]]``. ``b64`` below builds
 * the last one.
 */

import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

export const READY = /Message (Ember|igni)/;

/** A token no earlier run can have produced (see ``live-chat.spec.ts``). */
export function marker(): string {
  return `TKN${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
}

/** ``[[b64 ...]]``: the scripted model replies with exactly ``text``. */
export function sayExactly(text: string): string {
  return `[[b64 ${Buffer.from(text, "utf8").toString("base64")}]]`;
}

/** ``[[tool NAME {args}]]``. */
export function callTool(name: string, args: Record<string, unknown>): string {
  return `[[tool ${name} ${JSON.stringify(args)}]]`;
}

export async function open(page: Page, wsUrl: string, query = ""): Promise<void> {
  await page.goto(`/?ws=${encodeURIComponent(wsUrl)}${query}`);
  await connected(page);
}

export async function connected(page: Page, timeout = 60_000): Promise<void> {
  await expect(page.locator(".composer-editable")).toHaveAttribute(
    "data-placeholder",
    READY,
    { timeout },
  );
}

/** Type into the contenteditable composer and send. */
export async function send(page: Page, text: string): Promise<void> {
  const editor = page.locator(".composer-editable");
  await editor.click();
  await editor.fill(text);
  await editor.press("Enter");
}

/** Start from an empty transcript and wait until the session id rotated. */
export async function newChat(page: Page): Promise<void> {
  const chip = page.locator(".session-chip code");
  const before = (await chip.innerText()).trim();
  await page.getByRole("button", { name: /New chat/i }).click();
  await expect(page.locator(".msg-assistant")).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(async () => (await chip.innerText()).trim(), { timeout: 30_000 })
    .not.toBe(before);
}

export async function assistantSaid(page: Page, text: string | RegExp, timeout = 60_000) {
  await expect(
    page.locator(".msg-assistant").filter({ hasText: text }).first(),
  ).toBeVisible({ timeout });
}

/** The composer is idle again: a turn ended and the app takes more work. */
export async function idle(page: Page, timeout = 60_000): Promise<void> {
  await connected(page, timeout);
  await expect(page.getByRole("button", { name: /^(stop|cancel)/i })).toHaveCount(0, {
    timeout,
  });
}

/** Screenshot into ``shots/<dir>`` once nothing is animating. */
export async function shot(page: Page, dir: string, name: string): Promise<void> {
  mkdirSync(`shots/${dir}`, { recursive: true });
  await page
    .evaluate(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => (a.effect?.getTiming().iterations ?? 1) !== Infinity)
            .map((a) => a.finished.catch(() => undefined)),
        ),
        new Promise((r) => setTimeout(r, 1500)),
      ]),
    )
    .catch(() => undefined);
  await page.screenshot({ path: `shots/${dir}/${name}.png` });
}
