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
import { useHostBindings, type HostBindingsDeps } from "./useHostBindings";

afterEach(cleanup);

function deps(page: PageRoute | null, signedIn = true): HostBindingsDeps {
  return {
    client: { close: vi.fn() },
    windowModel: { write: vi.fn(), get: vi.fn(() => ({})) } as never,
    view: { reset: vi.fn() } as never,
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
});
