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

const TEMPLATE = readFileSync(
  resolve(__dirname, "../../../tauri/src-tauri/src/init_script.js"),
  "utf8",
);
const SCRIPT = TEMPLATE.replaceAll("__PLATFORM__", "win");

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
      core: { invoke: vi.fn((_cmd: string, _args?: unknown) => Promise.resolve<unknown>(false)) },
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

// Each test runs the script afresh; what one run added to the document
// is taken off again so the next starts clean.
const added: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];
const addToDocument = document.addEventListener.bind(document);

describe("the desktop shell's init script", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    vi.spyOn(document, "addEventListener").mockImplementation((name, handler, options) => {
      added.push([name, handler, options]);
      addToDocument(name, handler, options);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, handler, options] of added.splice(0)) document.removeEventListener(name, handler, options);
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it("registers the shell's event listeners once Tauri's API arrives after it ran", () => {
    runScript();
    const tauri = fakeTauri();
    (window as { __TAURI__?: unknown }).__TAURI__ = tauri.api;
    vi.advanceTimersByTime(100);
    expect([...tauri.listeners.keys()].sort()).toEqual(["igni-fullscreen", "igni-menu", "igni-open-link"]);
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

  it("on Windows runs the menu's shortcuts through the shell", () => {
    const tauri = fakeTauri();
    (window as { __TAURI__?: unknown }).__TAURI__ = tauri.api;
    runScript();
    const press = (init: KeyboardEventInit) => {
      const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(press({ key: "n", ctrlKey: true })).toBe(true);
    expect(press({ key: "N", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(press({ key: "q", ctrlKey: true })).toBe(true);
    expect(press({ key: "F11" })).toBe(true);
    expect(press({ key: "n" })).toBe(false);
    expect(press({ key: "c", ctrlKey: true })).toBe(false);
    const sent = tauri.api.core.invoke.mock.calls.filter((c) => c[0] === "igni_menu_shortcut").map((c) => c[1]);
    expect(sent).toEqual([{ id: "new_chat" }, { id: "new_window" }, { id: "quit_app" }, { id: "toggle_fullscreen" }]);
  });

  it("leaves shortcuts to the menu on macOS and Linux", () => {
    const tauri = fakeTauri();
    (window as { __TAURI__?: unknown }).__TAURI__ = tauri.api;
    new Function(TEMPLATE.replaceAll("__PLATFORM__", "linux"))();
    const e = new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(tauri.api.core.invoke.mock.calls.some((c) => c[0] === "igni_menu_shortcut")).toBe(false);
  });

  it("registers at once when the API is already there", () => {
    const tauri = fakeTauri();
    (window as { __TAURI__?: unknown }).__TAURI__ = tauri.api;
    runScript();
    expect(tauri.listeners.has("igni-menu")).toBe(true);
  });
});
