/**
 * Two tabs of one browser, on one real backend: one window, one session,
 * and both tabs work (F5, igni-app #96, CHAT-027).
 *
 * Every tab of a browser profile keeps the same window id in
 * `localStorage` (`clientState.ts`), so two tabs are two views of one
 * window model. The owner's word: both tabs follow the same session and
 * work properly, and the old tab must not die.
 *
 * What broke: each tab counted its window-model writes from 1 under the
 * window's id, so their tokens were alike and a tab took the other's
 * change for its own echo. When the second tab started a new chat, the
 * first tab's chip moved to it (the model's value) but its socket stayed
 * bound to the old session, so it dropped every event of the new one:
 * the other tab's messages and the replies to them never reached it.
 *
 * No model is needed: the fixture's backend points at a stub, and what
 * this asserts is that each tab paints what the other sent — the
 * backend's `user_message_received` broadcast, stamped with the session
 * — which is the event the stale binding dropped.
 */

import { expect, type BrowserContext, type Page } from "@playwright/test";

import { test } from "./fixtures/live-be";

const READY = /Message (Ember|igni)/;

function marker(): string {
  return `TKN${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
}

async function open(page: Page, wsUrl: string): Promise<void> {
  await page.goto(`/?ws=${encodeURIComponent(wsUrl)}`);
  await expect(page.locator(".composer-editable")).toHaveAttribute("data-placeholder", READY, {
    timeout: 60_000,
  });
}

/** A second tab of the same browser profile, offered the window token. */
async function secondTab(context: BrowserContext, token: string | null): Promise<Page> {
  const other = await context.newPage();
  if (token) {
    await other.addInitScript((value) => {
      (window as unknown as { __IGNI_WS_TOKEN__?: string }).__IGNI_WS_TOKEN__ = value;
    }, token);
  }
  return other;
}

async function chip(page: Page): Promise<string> {
  return (await page.locator(".session-chip code").innerText()).trim();
}

async function newChat(page: Page): Promise<void> {
  const before = await chip(page);
  await page.getByRole("button", { name: /New chat/i }).click();
  await expect.poll(() => chip(page), { timeout: 30_000 }).not.toBe(before);
}

async function send(page: Page, text: string): Promise<void> {
  const editor = page.locator(".composer-editable");
  await editor.click();
  await editor.fill(text);
  await editor.press("Enter");
}

function said(page: Page, text: string) {
  return page.locator(".msg-user").filter({ hasText: text });
}

test("two tabs of one browser follow one session, and either tab's message reaches both", async ({
  page,
  context,
  liveBe,
}) => {
  test.setTimeout(120_000);
  await open(page, liveBe.wsUrl);
  const other = await secondTab(context, liveBe.wsToken);
  await open(other, liveBe.wsUrl);
  expect(await chip(other), "the second tab opens on the first tab's session").toBe(await chip(page));

  // The newer tab starts a new chat: the older one follows it there.
  await newChat(other);
  await expect.poll(() => chip(page), { timeout: 15_000 }).toBe(await chip(other));

  const fromNew = marker();
  await send(other, `From the newer tab ${fromNew}`);
  await expect(said(other, fromNew)).toHaveCount(1);
  await expect(said(page, fromNew), "the older tab shows the newer tab's message").toHaveCount(1, {
    timeout: 15_000,
  });

  const fromOld = marker();
  await send(page, `From the older tab ${fromOld}`);
  await expect(said(page, fromOld)).toHaveCount(1);
  await expect(said(other, fromOld), "the newer tab shows the older tab's message").toHaveCount(1, {
    timeout: 15_000,
  });

  // The older tab starts a new chat: the newer one follows it there too.
  await newChat(page);
  await expect.poll(() => chip(other), { timeout: 15_000 }).toBe(await chip(page));
  const again = marker();
  await send(page, `Once more from the older tab ${again}`);
  await expect(said(other, again)).toHaveCount(1, { timeout: 15_000 });
});

test("closing the newer tab leaves the older one working", async ({ page, context, liveBe }) => {
  test.setTimeout(120_000);
  await open(page, liveBe.wsUrl);
  const other = await secondTab(context, liveBe.wsToken);
  await open(other, liveBe.wsUrl);
  await other.close();

  await expect(page.getByText(/opened elsewhere/i)).toHaveCount(0);
  await newChat(page);
  const after = marker();
  await send(page, `After the other tab closed ${after}`);
  await expect(said(page, after)).toHaveCount(1);
  await expect(page.locator(".composer-editable")).toHaveAttribute("data-placeholder", READY, {
    timeout: 60_000,
  });
});
