/**
 * An extension page can be linked to.
 *
 * Where an extension page is — the location it reports with the bridge's
 * `setLocation` — is folded into the window's address as
 * `?open=<page>&<location>` (`chat/arrival.ts`), so the address can be
 * copied, bookmarked or sent, and opening it anywhere lands on the same
 * page at the same place. Kept only in the window's saved route, the
 * same link opened in another browser showed the chat (R459).
 *
 * The extension is a real bundle served from its own origin and framed
 * by the client's `ExtensionFrame`: it shows the note it was opened on
 * (its `hello` params) and moves to another with `setLocation`.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser, Page } from "@playwright/test";

import { test, expect } from "./fixtures/embed";
import type { FixtureBackend } from "./fixtures/backend";

const NOTES_ID = "acme.notes";
const NOTES_PAGE = "acme.notes";

const PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Release notes</title></head>
<body>
<p>Note: <span id="note">none</span></p>
<button id="next">Next note</button>
<script>
(function () {
  var nonce = null;
  function show(params) {
    document.getElementById("note").textContent = (params && params.note) || "first";
  }
  window.addEventListener("message", function (event) {
    var m = event.data;
    if (!m || m.igni !== 1) return;
    if (m.kind === "hello") { nonce = m.nonce; show(m.params); }
    else if (m.kind === "params") show(m.params);
  });
  document.getElementById("next").addEventListener("click", function () {
    var state = { note: "2.3.1" };
    parent.postMessage({ igni: 1, kind: "location", nonce: nonce, state: state }, "*");
    show(state);
  });
})();
</script>
</body>
</html>
`;

async function serveNotes(): Promise<{ origin: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE_HTML);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function installNotes(be: FixtureBackend, origin: string) {
  be.onRpc("list_extensions", () => ({
    extensions: [
      {
        id: NOTES_ID,
        name: "Release notes",
        version: "1.0.0",
        state: "READY",
        reason: "",
        origin,
        allow: [],
        pages: [{ kind: NOTES_PAGE, label: "Release notes", sidebar: true, entry: "index.html" }],
        menu: [],
        indicators: [],
        settings: [],
        values: {},
        web_url: null,
        service_url: null,
        tools: [],
      },
    ],
  }));
  be.onRpc("notifications_counts", () => ({ unread: 0, by_source: {} }));
}

/** The note the framed page shows. */
function noteIn(page: Page) {
  return page.frameLocator("section.page iframe").locator("#note");
}

/** A browser that has never seen igni: no storage, no window. */
async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

let notes: { origin: string; close(): Promise<void> };
test.beforeEach(async () => {
  notes = await serveNotes();
});
test.afterEach(async () => {
  await notes.close();
});

test.describe("a link to an extension page", () => {
  test("opens the page at the location it names, in a browser that never saw it", async ({
    browser,
    backend,
    appUrl,
  }) => {
    installNotes(backend, notes.origin);
    const page = await freshPage(browser);
    await page.goto(`${appUrl}&open=${NOTES_PAGE}&note=2.2.0`);
    await expect(page.locator("section.page")).toHaveAttribute("aria-label", "Release notes");
    await expect(noteIn(page)).toHaveText("2.2.0");
    // The address is the place, still: the link survives sign-in.
    await expect.poll(() => new URL(page.url()).searchParams.get("note")).toBe("2.2.0");
    await page.context().close();
  });

  test("the address follows setLocation, and that address is the shareable link", async ({
    browser,
    backend,
    appUrl,
  }) => {
    installNotes(backend, notes.origin);
    const first = await freshPage(browser);
    await first.goto(appUrl);
    await first.getByRole("button", { name: "Release notes" }).first().click();
    await expect(noteIn(first)).toHaveText("first");
    // A page with no location yet is still named.
    await expect.poll(() => new URL(first.url()).searchParams.get("open")).toBe(NOTES_PAGE);

    await first.frameLocator("section.page iframe").getByRole("button", { name: "Next note" }).click();
    await expect.poll(() => new URL(first.url()).searchParams.get("note")).toBe("2.3.1");
    const shared = first.url();
    // igni's own parameters are kept beside the page's.
    expect(new URL(shared).searchParams.get("ws")).toBe(backend.url);

    const second = await freshPage(browser);
    await second.goto(shared);
    await expect(second.locator("section.page")).toHaveAttribute("aria-label", "Release notes");
    await expect(noteIn(second)).toHaveText("2.3.1");

    await first.context().close();
    await second.context().close();
  });

  test("to a page that is not installed opens the chat", async ({ browser, backend, appUrl }) => {
    installNotes(backend, notes.origin);
    const page = await freshPage(browser);
    await page.goto(`${appUrl}&open=acme.missing&note=1`);
    await expect(page.locator(".composer-editable")).toBeVisible();
    await expect(page.locator("section.page")).toHaveCount(0);
    await page.context().close();
  });

  test("whose page kind is markup opens the chat and draws nothing of it", async ({
    browser,
    backend,
    appUrl,
  }) => {
    installNotes(backend, notes.origin);
    const page = await freshPage(browser);
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs++;
      void d.dismiss();
    });
    await page.goto(`${appUrl}&open=${encodeURIComponent("<img src=x onerror=alert(1)>")}`);
    await expect(page.locator(".composer-editable")).toBeVisible();
    await expect(page.locator("section.page")).toHaveCount(0);
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    expect(dialogs).toBe(0);
    await page.context().close();
  });
});
