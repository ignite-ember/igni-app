// @vitest-environment jsdom
/**
 * The desktop shell's init script (clients/tauri/src-tauri/src/init_script.js),
 * run in a page the way the webview runs it: before the app's own code,
 * and on Windows before Tauri has set `window.__TAURI__` (R624, desktop
 * proof run 44810142993: New Chat and Check for Updates never reached the
 * page there, because the listeners were only registered if the API was
 * already present when the script ran).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRIPT = readFileSync(
  resolve(__dirname, "../../../tauri/src-tauri/src/init_script.js"),
  "utf8",
).replace("__PLATFORM__", "win");

type Listener = (e: { payload: unknown }) => void;

/** A stand-in for Tauri's global API that records each listener. */
function fakeTauri() {
  const listeners = new Map<string, Listener>();
  const listen = (name: string, handler: Listener) => {
    listeners.set(name, handler);
    return Promise.resolve(() => listeners.delete(name));
  };
  return {
    listeners,
    api: {
      core: { invoke: vi.fn(() => Promise.resolve(false)) },
      event: { listen },
      webviewWindow: { getCurrentWebviewWindow: () => ({ label: "main", listen }) },
    },
  };
}

function runScript() {
  // The script is a classic script, run as the webview runs it.
  new Function(SCRIPT)();
}

/**
 * The document as WebView2 hands it to a script that runs when the
 * document is created: no <html> element yet. Listeners added to it are
 * kept so the test can fire them once the element exists.
 */
function documentBeforeHtml() {
  const handlers: Record<string, Array<() => void>> = {};
  let html: HTMLElement | null = null;
  const doc = new Proxy(document, {
    get(target, key) {
      if (key === "documentElement") return html;
      if (key === "addEventListener") {
        return (name: string, handler: () => void) => {
          if (name === "readystatechange" || name === "DOMContentLoaded") {
            (handlers[name] ??= []).push(handler);
            return;
          }
          target.addEventListener(name, handler as EventListener, true);
        };
      }
      if (key === "removeEventListener") {
        return (name: string, handler: () => void) => {
          handlers[name] = (handlers[name] ?? []).filter((h) => h !== handler);
        };
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    doc,
    parse() {
      html = document.createElement("html");
      for (const handler of [...(handlers.readystatechange ?? []), ...(handlers.DOMContentLoaded ?? [])]) handler();
      return html;
    },
  };
}

function runScriptIn(doc: Document) {
  new Function("document", SCRIPT)(doc);
}

describe("the desktop shell's init script", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it("registers the shell's event listeners once Tauri's API arrives after it ran", () => {
    runScript();
    const tauri = fakeTauri();
    (window as { __TAURI__?: unknown }).__TAURI__ = tauri.api;
    vi.advanceTimersByTime(100);
    expect([...tauri.listeners.keys()].sort()).toEqual([
      "igni-backend-state",
      "igni-fullscreen",
      "igni-menu",
      "igni-open-link",
    ]);
  });

  it("turns a menu event into the page's igni-host event", () => {
    runScript();
    const tauri = fakeTauri();
    (window as { __TAURI__?: unknown }).__TAURI__ = tauri.api;
    vi.advanceTimersByTime(100);
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("igni-host", on);
    tauri.listeners.get("igni-menu")?.({ payload: "new_chat" });
    window.removeEventListener("igni-host", on);
    expect(seen).toEqual([{ type: "igni:menu", payload: { id: "new_chat" } }]);
  });

  it("runs to the end in a document that has no <html> element yet (WebView2)", () => {
    const tauri = fakeTauri();
    (window as { __TAURI__?: unknown }).__TAURI__ = tauri.api;
    const early = documentBeforeHtml();
    expect(() => runScriptIn(early.doc)).not.toThrow();
    expect(tauri.listeners.has("igni-menu")).toBe(true);
    expect(typeof (window as { __IGNI_PICK_DIR__?: unknown }).__IGNI_PICK_DIR__).toBe("function");
    const html = early.parse();
    expect(html.dataset.host).toBe("tauri");
    expect(html.dataset.platform).toBe("win");
  });

  it("registers at once when the API is already there", () => {
    const tauri = fakeTauri();
    (window as { __TAURI__?: unknown }).__TAURI__ = tauri.api;
    runScript();
    expect(tauri.listeners.has("igni-menu")).toBe(true);
  });
});
