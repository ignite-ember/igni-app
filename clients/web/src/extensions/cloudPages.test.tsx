// @vitest-environment jsdom
/**
 * Extension pages on the desktop's cloud side (design §15.5): the
 * backend's origin is never framed, every list is localised to the
 * shell's origin, a frame loads only once the cloud igni is ready, and a
 * new connection generation remounts it with a new nonce.
 */

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackendStateContext } from "../cloud/backendContext";
import { BackendSnapshot } from "../cloud/backendState";
import { shellSnapshot } from "../cloud/testing";
import type { ConnectionState } from "../protocol/client";
import { localiseOrigins, withoutOrigins } from "./cloudPageOrigins";
import { ExtensionPage, type ExtensionSummary } from "./ExtensionPage";
import { ExtensionPageHost } from "./ExtensionPageHost";
import { useExtensions } from "./useExtensions";

afterEach(() => {
  cleanup();
  delete window.__TAURI__;
  window.history.replaceState(null, "", "/");
});

const VM_ORIGIN = "http://127.0.0.1:41234";
const SHELL_ORIGIN = "http://127.0.0.1:50001";

const ext = (id: string, origin = VM_ORIGIN): ExtensionSummary => ({
  id,
  name: id,
  version: "1",
  state: "READY",
  reason: "",
  origin,
  allow: [],
  pages: [{ kind: `${id}.page`, label: "Page", sidebar: true, entry: "index.html" }],
  menu: [],
  indicators: [],
  settings: [],
  values: {},
});

describe("localiseOrigins", () => {
  it("never returns the backend's origin on the cloud", async () => {
    const resolve = vi.fn(async (id: string) => (id === "acme.a" ? SHELL_ORIGIN : "http://127.0.0.1:50002"));
    const out = await localiseOrigins([ext("acme.a"), ext("acme.b"), ext("acme.none", "")], "cloud", resolve);
    expect(out.map((e) => e.origin)).toEqual([SHELL_ORIGIN, "http://127.0.0.1:50002", ""]);
    expect(out.some((e) => e.origin === VM_ORIGIN)).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("gives an empty origin when the shell cannot answer", async () => {
    const out = await localiseOrigins([ext("acme.a")], "cloud", async () => {
      throw new Error("not in cloud mode");
    });
    expect(out[0].origin).toBe("");
  });

  it("leaves the list alone on this computer", async () => {
    const resolve = vi.fn();
    const listed = [ext("acme.a")];
    expect(await localiseOrigins(listed, "local", resolve)).toEqual(listed);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("asks the shell's cloud_page_origin and refuses anything but a loopback origin", async () => {
    const invoke = vi.fn(async (_cmd: string, args?: Record<string, unknown>) => (args?.extensionId === "acme.a" ? SHELL_ORIGIN : "https://evil.example"));
    window.__TAURI__ = { core: { invoke } };
    const out = await localiseOrigins([ext("acme.a"), ext("acme.b")], "cloud");
    expect(invoke).toHaveBeenCalledWith("cloud_page_origin", { extensionId: "acme.a" });
    expect(out.map((e) => e.origin)).toEqual([SHELL_ORIGIN, ""]);
    expect(withoutOrigins([ext("acme.a")])[0].origin).toBe("");
  });
});

describe("useExtensions on the cloud", () => {
  const windowModel = { get: vi.fn(() => []), write: vi.fn() };

  it("localises the list it fetches", async () => {
    const client = { rpc: vi.fn(async () => ({ extensions: [ext("acme.a")] })) };
    const resolve = vi.fn(async () => SHELL_ORIGIN);
    const { result } = renderHook(() => useExtensions(client as never, true, windowModel as never, "cloud", resolve));
    await waitFor(() => expect(result.current.extensions[0]?.origin).toBe(SHELL_ORIGIN));
  });

  it("localises every setExtensions too, and never stores the backend's origin", async () => {
    const client = { rpc: vi.fn(async () => ({ extensions: [] })) };
    let release: (o: string) => void = () => {};
    const resolve = vi.fn(() => new Promise<string>((r) => (release = r)));
    // Not connected, so nothing is fetched under the panel's own write.
    const { result } = renderHook(() => useExtensions(client as never, false, windowModel as never, "cloud", resolve));
    act(() => result.current.setExtensions([ext("acme.a")]));
    expect(result.current.extensions[0].origin).toBe("");
    await act(async () => release(SHELL_ORIGIN));
    expect(result.current.extensions[0].origin).toBe(SHELL_ORIGIN);
    // The functional form works on what is stored, and is localised too.
    act(() => result.current.setExtensions((prev) => [...prev, ext("acme.b")]));
    expect(result.current.extensions.map((e) => e.origin)).toEqual(["", ""]);
    expect(result.current.extensions.map((e) => e.id)).toEqual(["acme.a", "acme.b"]);
  });

  it("keeps the backend's origin on this computer", async () => {
    const client = { rpc: vi.fn(async () => ({ extensions: [ext("acme.a")] })) };
    const { result } = renderHook(() => useExtensions(client as never, true, windowModel as never, "local"));
    await waitFor(() => expect(result.current.extensions[0]?.origin).toBe(VM_ORIGIN));
  });
});

describe("a frame on the cloud", () => {
  const snap = (state: string) => BackendSnapshot.parse(shellSnapshot({ side: "cloud", state }))!;

  function drawIn(state: string | null) {
    return render(
      <BackendStateContext.Provider value={state === null ? null : snap(state)}>
        <ExtensionPage extension={ext("acme.a", SHELL_ORIGIN)} kind="acme.a.page" onCall={async () => null} />
      </BackendStateContext.Provider>,
    );
  }

  it("is mounted only in CloudReady", () => {
    window.history.replaceState(null, "", "/?side=cloud");
    for (const state of ["dialing", "waking", "cloud_needs_sign_in", "cloud_unreachable", "refused", null]) {
      const { container } = drawIn(state);
      expect(container.querySelector("iframe"), String(state)).toBeNull();
      expect(screen.getByText("acme.a opens once your cloud igni is ready.")).toBeTruthy();
      cleanup();
    }
    const { container } = drawIn("cloud_ready");
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(`${SHELL_ORIGIN}/index.html`);
  });

  it("is mounted on this computer whatever the switch says", () => {
    window.history.replaceState(null, "", "/?side=local");
    const { container } = drawIn(null);
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("remounts with a new nonce on a new connection generation", () => {
    const listeners = new Set<(s: ConnectionState) => void>();
    const client = {
      generation: 1,
      onStateChange: (fn: (s: ConnectionState) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      asExtension: () => ({ rpc: async () => null }),
    };
    const { container } = render(
      <ExtensionPageHost
        extension={ext("acme.a", SHELL_ORIGIN)}
        page={{ kind: "acme.a.page", label: "Page" }}
        client={client as never}
        homeWindow="w"
        theme="dark"
        signals={undefined}
        onClose={() => {}}
      />,
    );
    const helloNonce = (frame: HTMLIFrameElement) => {
      const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
      fireEvent.load(frame);
      const hello = post.mock.calls.map((c) => c[0] as { kind?: string; nonce?: string }).find((m) => m.kind === "hello");
      return hello?.nonce;
    };
    const first = container.querySelector("iframe")!;
    const firstNonce = helloNonce(first);
    expect(firstNonce).toBeTruthy();
    // A node move: the client is connected again on the same socket.
    act(() => {
      client.generation = 2;
      for (const fn of listeners) fn("connected");
    });
    const second = container.querySelector("iframe")!;
    expect(second).not.toBe(first);
    expect(helloNonce(second)).not.toBe(firstNonce);
    // Anything else leaves the frame mounted.
    act(() => {
      for (const fn of listeners) fn("disconnected");
    });
    expect(container.querySelector("iframe")).toBe(second);
  });
});
