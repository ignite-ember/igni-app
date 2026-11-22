// @vitest-environment jsdom
/**
 * The header's account chip and the footer's backend chip in the whole
 * window on the desktop's cloud side (R691, G and H1).
 *
 * G: right after a switch to cloud mode, the VM's igni names nobody and
 * this computer's account-only backend has not answered yet; the header
 * said "Log in" for those seconds. H1: a cloud-mode app started while
 * its cloud cannot be reached has no status from the window's socket,
 * and the footer drew no "Cloud · offline" chip for as long as that
 * lasted.
 *
 * Its own file because it installs `window.__TAURI__`, and `host` keeps
 * a Tauri kind once it has seen one.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, render, screen, waitFor } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { WebSocket as NodeWebSocket } from "ws";

import App from "./App";
import { shellSnapshot } from "./cloud/testing";
import { startFixtureBackend, type FixtureBackend } from "../e2e/fixtures/backend";

/** The browser-facing WebSocket, carried over Node's `ws`. */
class BridgedWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private inner: NodeWebSocket;
  constructor(url: string, protocols?: string[]) {
    this.inner = new NodeWebSocket(url, protocols);
    this.inner.on("open", () => {
      this.readyState = 1;
      act(() => this.onopen?.({}));
    });
    this.inner.on("message", (data) => {
      act(() => this.onmessage?.({ data: data.toString() }));
    });
    this.inner.on("close", (code) => {
      this.readyState = 3;
      act(() => this.onclose?.({ code }));
    });
    this.inner.on("error", () => this.onerror?.({}));
  }
  send(data: string) {
    this.inner.send(data);
  }
  close() {
    this.inner.close();
  }
}

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20_000 });

beforeAll(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = BridgedWebSocket;
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as never;
  console.info = () => {};
});

let be: FixtureBackend | undefined;

afterEach(async () => {
  cleanup();
  delete window.__TAURI__;
  await be?.close();
  be = undefined;
  window.localStorage?.clear?.();
});

const CLOUD = "side=cloud&backend=cloud-0123456789ab&";

function desktop(snapshot: Record<string, unknown>, accountStatus: () => Promise<unknown>) {
  window.__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: { method?: string }) => {
        if (cmd === "backend_state") return snapshot;
        if (cmd === "account_rpc" && args?.method === "get_status") return accountStatus();
        return null;
      },
    },
  } as never;
}

function openWindow(ws: string) {
  window.history.replaceState({}, "", `/?${CLOUD}ws=${encodeURIComponent(ws)}`);
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 4000, itemHeight: 40 }}>
      <App />
    </VirtuosoMockContext.Provider>,
  );
}

describe("the desktop's cloud side, in the whole window", () => {
  it("never says Log in while this computer has not said who is signed in", async () => {
    // The VM's igni runs on its own credential and names nobody.
    be = await startFixtureBackend({
      clientId: "vm-1",
      rpcHandlers: {
        get_status: () => ({ cloud_email: "", cloud_connected: true, context_tokens: 0, max_context: 1000 }),
        get_chat_history: () => [],
        get_pending_messages: () => [],
      },
    });
    let answer: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => (answer = resolve));
    desktop(shellSnapshot({ side: "cloud", state: "cloud_ready", mode: "cloud", switch_visible: false }), () => pending);
    openWindow(be.url);

    await waitFor(() => expect(screen.getByRole("button", { name: "Account" }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.queryByText("Log in")).toBeNull();

    await act(async () => answer({ cloud_email: "ada@acme.example", cloud_connected: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: /ada@acme\.example/ })).toBeTruthy());
    expect(screen.queryByText("Log in")).toBeNull();
  });

  it("shows Cloud · offline while the cloud window has no connection", async () => {
    // Nothing listens: the gateway is unreachable, the window never connects.
    const nobody = await startFixtureBackend({ clientId: "gone" });
    const deadUrl = nobody.url;
    await nobody.close();
    desktop(
      shellSnapshot({
        side: "cloud",
        state: "cloud_unreachable",
        reason: "network",
        mode: "cloud",
        switch_visible: false,
        can_use_local: false,
        backend_key: "cloud-0123456789ab",
      }),
      () => new Promise(() => {}),
    );
    openWindow(deadUrl);

    await waitFor(() => expect(document.querySelector(".backend-chip")?.textContent).toBe("Cloud · offline"));
    expect(screen.queryByText("Log in")).toBeNull();
  });
});
