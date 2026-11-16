// @vitest-environment jsdom
/**
 * The address bar follows the page a window is on.
 *
 * An extension page's setLocation lands in the top page's params; the
 * bridge promises the host folds it into its own URL, so a reload or the
 * same link opened in another browser comes back to it. Kept only in the
 * window's saved route, the address never changed (R459).
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Arrivals } from "../chat/arrival";
import type { PageRoute } from "../chat/pageStack";
import { host } from "./host";
import { useHostBindings, type HostBindingsDeps } from "./useHostBindings";

afterEach(cleanup);

function deps(page: PageRoute | null, signedIn = true): HostBindingsDeps {
  return {
    windowModel: { write: vi.fn(), get: vi.fn(() => ({})) } as never,
    newChat: vi.fn(),
    updateCheck: { checkNow: vi.fn() } as never,
    page,
    signedIn,
    projectDir: "",
    org: "",
  };
}

const notes = (version: string): PageRoute => ({
  kind: "acme.notes",
  label: "Release notes",
  params: { version },
});

describe("the address bar", () => {
  it("carries the page's location, and drops it back at the chat", () => {
    window.history.replaceState(null, "", "/?ws=ws%3A%2F%2Fx#igni_ws_token=t");
    const { rerender } = renderHook((d: HostBindingsDeps) => useHostBindings(d), {
      initialProps: deps(notes("2.4.0")),
    });

    rerender(deps(notes("2.3.1")));
    expect(Arrivals.fromSearch(window.location.search)).toEqual({
      page: "acme.notes",
      params: { version: "2.3.1" },
    });
    expect(new URLSearchParams(window.location.search).get("ws")).toBe("ws://x");
    expect(window.location.hash).toBe("#igni_ws_token=t");

    rerender(deps(null));
    expect(window.location.search).toBe("?ws=ws%3A%2F%2Fx");
  });

  it("is left alone before sign-in: the link is still where the window is going", () => {
    window.history.replaceState(null, "", "/?open=acme.notes&version=2.3.1");
    renderHook(() => useHostBindings(deps(null, false)));
    expect(window.location.search).toBe("?open=acme.notes&version=2.3.1");
  });

  it("names a page without a location, so the address still opens it", () => {
    window.history.replaceState(null, "", "/?ws=ws%3A%2F%2Fx");
    renderHook(() => useHostBindings(deps({ kind: "acme.notes", label: "Release notes" })));
    expect(Arrivals.fromSearch(window.location.search)).toEqual({ page: "acme.notes", params: {} });
  });
});

describe("going back to an older address", () => {
  function popTo(url: string) {
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  it("goes where that address says, or to the chat", () => {
    window.history.replaceState(null, "", "/?ws=ws%3A%2F%2Fx");
    const d = deps(notes("2.3.1"));
    renderHook(() => useHostBindings(d));

    popTo("/?ws=ws%3A%2F%2Fx&open=acme.notes&version=2.2.0");
    expect(d.windowModel.write).toHaveBeenLastCalledWith("route", [
      { kind: "acme.notes", label: "acme.notes", params: { version: "2.2.0" } },
    ]);

    popTo("/?ws=ws%3A%2F%2Fx");
    expect(d.windowModel.write).toHaveBeenLastCalledWith("route", []);
  });

  it("is no move when the address is where the window already is", () => {
    window.history.replaceState(null, "", "/?ws=ws%3A%2F%2Fx");
    const d = deps(notes("2.3.1"));
    renderHook(() => useHostBindings(d));
    // The window wrote its place; a fragment change pops the same address.
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(d.windowModel.write).not.toHaveBeenCalledWith("route", expect.anything());
  });

  it("stops listening when the window goes", () => {
    window.history.replaceState(null, "", "/?ws=ws%3A%2F%2Fx");
    const d = deps(null);
    const { unmount } = renderHook(() => useHostBindings(d));
    unmount();
    popTo("/?open=acme.notes&version=2.2.0");
    expect(d.windowModel.write).not.toHaveBeenCalledWith("route", expect.anything());
  });
});

describe("an igni:// link the desktop shell was handed", () => {
  function shellHolding(links: (string | null)[]) {
    const invoke = vi.fn(async (cmd: string) => (cmd === "igni_take_open_link" ? (links.shift() ?? null) : null));
    (window as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
    return invoke;
  }
  afterEach(() => {
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it("opens the page it names, at its location, once signed in", async () => {
    const invoke = shellHolding(["igni://open?open=acme.notes&version=2.3.1"]);
    const d = deps(null);
    renderHook(() => useHostBindings(d));
    await vi.waitFor(() =>
      expect(d.windowModel.write).toHaveBeenCalledWith("route", [
        { kind: "acme.notes", label: "acme.notes", params: { version: "2.3.1" } },
      ]),
    );
    expect(invoke).toHaveBeenCalledWith("igni_take_open_link");
  });

  it("opens the chat for a link to no page igni could have", async () => {
    shellHolding(["igni://open?open=..%2Fetc"]);
    const d = deps(null);
    renderHook(() => useHostBindings(d));
    await vi.waitFor(() => expect(d.windowModel.write).toHaveBeenCalledWith("route", []));
  });

  it("takes a link followed while running when the shell says one is waiting", async () => {
    shellHolding([null, "igni://open?open=plugins"]);
    const d = deps(null);
    renderHook(() => useHostBindings(d));
    await Promise.resolve();
    expect(d.windowModel.write).not.toHaveBeenCalledWith("route", expect.anything());
    window.dispatchEvent(new CustomEvent("igni-host", { detail: { type: "igni:open-link" } }));
    await vi.waitFor(() =>
      expect(d.windowModel.write).toHaveBeenCalledWith("route", [
        { kind: "plugins", label: "plugins", params: {} },
      ]),
    );
  });

  it("waits for sign-in", async () => {
    const invoke = shellHolding(["igni://open?open=plugins"]);
    renderHook(() => useHostBindings(deps(null, false)));
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("the native menu", () => {
  it("starts a new chat the way the sidebar does, not by blanking the view", () => {
    let fire: (id: string) => void = () => {};
    vi.spyOn(host, "onMenu").mockImplementation((handler) => {
      fire = handler as (id: string) => void;
      return () => {};
    });
    const d = deps(null);
    renderHook(() => useHostBindings(d));
    fire("new_chat");
    expect(d.newChat).toHaveBeenCalledOnce();
  });
});
