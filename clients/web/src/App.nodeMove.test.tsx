// @vitest-environment jsdom
/**
 * A node move under an open extension page (design §4.3, §15.5), the
 * whole window against the fixture backend over a real loopback socket.
 *
 * The cloud gateway moves a session by reconnecting behind the window's
 * socket; the window only sees igni's second `welcome` on that socket.
 * The page's frame must remount (a new document, a new nonce) so it
 * says `hello` again and re-subscribes in the igni that now answers.
 * The parts have unit tests (`client.resync.test.ts`,
 * `cloudPages.test.tsx`); this proves they are wired together: the
 * real `IgniClient`, `App`, `AppPages` and `ExtensionPageHost`.
 *
 * Its own file because the cloud case installs `window.__TAURI__`, and
 * `host` keeps a Tauri kind once it has seen one.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  await be?.close();
  be = undefined;
  window.localStorage?.clear?.();
});

const VM_ORIGIN = "http://127.0.0.1:41234";
const SHELL_ORIGIN = "http://127.0.0.1:50009";

/** One installed extension with a sidebar page, as `list_extensions` lists it. */
const listed = () => ({
  extensions: [
    {
      id: "acme.reviewer",
      name: "Reviewer",
      version: "1",
      state: "READY",
      reason: "",
      origin: VM_ORIGIN,
      allow: [],
      pages: [{ kind: "acme.reviewer.page", label: "Reviews", sidebar: true, entry: "index.html" }],
      menu: [],
      indicators: [],
      settings: [],
      values: {},
    },
  ],
});

async function openPage(search: string): Promise<HTMLIFrameElement> {
  be = await startFixtureBackend({
    clientId: "vm-1",
    rpcHandlers: {
      list_extensions: listed,
      get_chat_history: () => [],
      get_pending_messages: () => [],
      get_workspace_trust: () => ({
        state: "trusted",
        can_trust: true,
        reason: "",
        path: "/tmp/test-project",
        remote: null,
        policy_mode: "ask",
        gated: "",
      }),
    },
  });
  window.history.replaceState({}, "", `/?${search}ws=${encodeURIComponent(be.url)}`);
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 4000, itemHeight: 40 }}>
      <App />
    </VirtuosoMockContext.Provider>,
  );
  fireEvent.click(await screen.findByText("Reviews"));
  await waitFor(() => expect(document.querySelector("iframe.extension-frame")).not.toBeNull());
  return document.querySelector<HTMLIFrameElement>("iframe.extension-frame")!;
}

/** The nonce the frame is greeted with on load. */
function helloNonce(frame: HTMLIFrameElement): string | undefined {
  const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
  fireEvent.load(frame);
  const hello = post.mock.calls.map((c) => c[0] as { kind?: string; nonce?: string }).find((m) => m.kind === "hello");
  post.mockRestore();
  return hello?.nonce;
}

/** What the gateway sends after a move: the cut-off answer to a call in
 *  flight, then the new igni's `welcome`, on the same socket. */
function moveTheSession() {
  be!.pushEvent({ type: "rpc_response", id: "in-flight-1", error: "igni's connection was moved; retry" });
  be!.pushEvent({ type: "welcome", client_id: "vm-2" });
}

describe("a node move under an open extension page", () => {
  it("remounts the frame with a new nonce, on the same socket", async () => {
    const first = await openPage("");
    const firstNonce = helloNonce(first);
    expect(firstNonce).toBeTruthy();
    const sockets = be!.clientCount();

    moveTheSession();

    await waitFor(() => expect(document.querySelector("iframe.extension-frame")).not.toBe(first));
    const second = document.querySelector<HTMLIFrameElement>("iframe.extension-frame")!;
    expect(second.isConnected).toBe(true);
    expect(first.isConnected).toBe(false);
    expect(helloNonce(second)).not.toBe(firstNonce);
    // The window did not reconnect: the move happened behind its socket.
    expect(be!.clientCount()).toBe(sockets);
  });

  it("remounts it on the desktop's cloud side, still framed from the shell's origin", async () => {
    window.__TAURI__ = {
      core: {
        invoke: async (cmd: string) => {
          if (cmd === "backend_state") {
            return shellSnapshot({ side: "cloud", state: "cloud_ready", backend_key: "cloud-0123456789ab" });
          }
          if (cmd === "cloud_page_origin") return SHELL_ORIGIN;
          return null;
        },
      },
    } as never;
    try {
      await openPage("side=cloud&backend=cloud-0123456789ab&");
      await waitFor(() => expect(document.querySelector("iframe.extension-frame")?.getAttribute("src")).toBe(`${SHELL_ORIGIN}/index.html`));
      const framed = document.querySelector<HTMLIFrameElement>("iframe.extension-frame")!;
      const firstNonce = helloNonce(framed);

      moveTheSession();

      await waitFor(() => expect(document.querySelector("iframe.extension-frame")).not.toBe(framed));
      const second = document.querySelector<HTMLIFrameElement>("iframe.extension-frame")!;
      expect(second.getAttribute("src")).toBe(`${SHELL_ORIGIN}/index.html`);
      expect(helloNonce(second)).not.toBe(firstNonce);
    } finally {
      delete window.__TAURI__;
    }
  });
});
