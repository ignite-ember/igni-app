// @vitest-environment jsdom
/**
 * The desktop app's initialization script, run.
 *
 * ``clients/tauri/src-tauri/src/init_script.js`` is the app's first
 * code in every page load: it registers the shell's event listeners
 * (the menu, a followed ``igni://`` link, the fullscreen state) and
 * stamps the host on the document's root.
 *
 * Windows injects the script at document start, where the document's
 * root element does not exist yet. The script used to read the root
 * unguarded, and the throw that caused aborted the whole script — so
 * the window never registered its listeners, never heard the shell's
 * link and never opened the page a followed ``igni://`` link names.
 * Linux and macOS run the same script with the root already there,
 * which is why only Windows showed it.
 *
 * These tests run the script against a document with no root and say
 * whether the listeners are registered anyway.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The script as the shell injects it, before the platform token is replaced. */
const SCRIPT = readFileSync(
  path.join(HERE, "..", "..", "..", "tauri", "src-tauri", "src", "init_script.js"),
  "utf8",
);

/** What the script registered, and the handlers it registered them with. */
type Harness = {
  registered: string[];
  handlers: Map<string, (event: unknown) => void>;
};

/**
 * Stand in for the Tauri API the script talks to. The window's own
 * ``listen`` is what the script prefers: a global listen would hear
 * every window's events.
 */
function stubTheTauriApi(): Harness {
  const registered: string[] = [];
  const handlers = new Map<string, (event: unknown) => void>();
  const current = {
    label: "main",
    listen: (name: string, handler: (event: unknown) => void) => {
      registered.push(name);
      handlers.set(name, handler);
      return Promise.resolve();
    },
  };
  (window as unknown as Record<string, unknown>).__TAURI__ = {
    core: { invoke: vi.fn().mockResolvedValue(undefined) },
    event: {
      listen: (name: string) => {
        registered.push(`any:${name}`);
        return Promise.resolve();
      },
    },
    webviewWindow: { getCurrentWebviewWindow: () => current },
  };
  return { registered, handlers };
}

/** Run the script the way the webview does. */
function runTheScript() {
  // A plain script, not a module: it runs against the window it finds.
  new Function(SCRIPT)();
}

describe("the desktop app's initialization script", () => {
  it("registers the shell's listeners when the document has no root element", () => {
    // The script waits for the API and for the root; the fake clock
    // keeps those waits from outliving the test.
    vi.useFakeTimers();
    // Windows: the script runs at document start, before the root
    // element exists.
    Object.defineProperty(document, "documentElement", {
      configurable: true,
      get: () => null,
    });
    try {
      const harness = stubTheTauriApi();
      runTheScript();

      expect(harness.registered).toEqual([
        "igni-menu",
        "igni-open-link",
        "igni-fullscreen",
      ]);
    } finally {
      delete (document as unknown as Record<string, unknown>).documentElement;
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("hands the shell's link to the page as a DOM event", () => {
    vi.useFakeTimers();
    try {
      const harness = stubTheTauriApi();
      runTheScript();

      const seen: unknown[] = [];
      window.addEventListener("igni-host", (event) => {
        seen.push((event as CustomEvent).detail);
      });
      // The shell emits the event; the page's own listener turns it into
      // the DOM event the web UI listens for.
      harness.handlers.get("igni-open-link")?.({ payload: null });

      expect(seen).toEqual([{ type: "igni:open-link" }]);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("stamps the host on the root element when there is one", () => {
    vi.useFakeTimers();
    try {
      stubTheTauriApi();
      runTheScript();

      expect(document.documentElement.dataset.host).toBe("tauri");
      // The token the shell replaces with the OS name (init_script.rs).
      expect(document.documentElement.dataset.platform).toBe("__PLATFORM__");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
