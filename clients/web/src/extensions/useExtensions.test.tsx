// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageRoute } from "../chat/pageStack";
import { useExtensions } from "./useExtensions";

const kb = {
  id: "kb",
  name: "Knowledge",
  pages: [{ kind: "kb", label: "Knowledge base", sidebar: true, entry: "/" }],
  menu: [{ label: "KB search", command: "/kb", desc: "search" }],
};

function fakes(route: PageRoute[] = []) {
  const client = { rpc: vi.fn(async () => ({ extensions: [kb] })) };
  const state = { route };
  const windowModel = {
    get: vi.fn(() => state.route),
    write: vi.fn((_field: "route", value: PageRoute[]) => {
      state.route = value;
    }),
  };
  return { client, windowModel, state };
}

afterEach(() => vi.restoreAllMocks());

describe("useExtensions", () => {
  it("asks again when a node move cut the list off, and folds it in", async () => {
    // The cloud's gateway answers a call in flight during a node move with
    // "igni's connection was moved": retryable, and good again a moment later.
    const { client, windowModel } = fakes();
    const moved = Object.assign(new Error("igni's connection moved while this was in flight. Try again."), {
      name: "ConnectionMovedError",
      retryable: true,
    });
    client.rpc.mockRejectedValueOnce(moved);
    const { result } = renderHook(() => useExtensions(client as never, true, windowModel as never));
    await waitFor(() => expect(result.current.extensions).toHaveLength(1), { timeout: 3000 });
    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(result.current.contributions.sidebar().map((l) => l.kind)).toContain("kb");
  });

  it("does not ask again for an error that is not retryable", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { client, windowModel } = fakes();
    client.rpc.mockRejectedValueOnce(new Error("unknown method"));
    const { result } = renderHook(() => useExtensions(client as never, true, windowModel as never));
    await waitFor(() => expect(info).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 700));
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(result.current.extensions).toHaveLength(0);
  });

  it("gives up after its retries", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const { client, windowModel } = fakes();
      client.rpc.mockRejectedValue(Object.assign(new Error("moved"), { retryable: true }));
      renderHook(() => useExtensions(client as never, true, windowModel as never));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(client.rpc).toHaveBeenCalledTimes(6);
      expect(info).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("folds what is listed into the nav once connected", async () => {
    const { client, windowModel } = fakes();
    const { result, rerender } = renderHook(({ connected }) => useExtensions(client as never, connected, windowModel as never), {
      initialProps: { connected: false },
    });
    expect(client.rpc).not.toHaveBeenCalled();
    rerender({ connected: true });
    await waitFor(() => expect(result.current.extensions).toHaveLength(1));
    expect(result.current.contributions.sidebar().map((l) => l.kind)).toContain("kb");
    expect(result.current.contributions.tools().map((t) => t.label)).toContain("KB search");
    expect(result.current.extensionNames.get("kb")).toBe("Knowledge");
  });

  it("names a page a link opened before its extension was listed", async () => {
    const { client, windowModel, state } = fakes([{ kind: "kb", label: "kb" }]);
    renderHook(() => useExtensions(client as never, true, windowModel as never));
    await waitFor(() => expect(state.route).toEqual([{ kind: "kb", label: "Knowledge base" }]));
  });

  it("mounts, unmounts and mounts again without refusing its own pages", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client, windowModel } = fakes();
    const first = renderHook(() => useExtensions(client as never, true, windowModel as never));
    await waitFor(() => expect(first.result.current.extensions).toHaveLength(1));
    first.unmount();
    const second = renderHook(() => useExtensions(client as never, true, windowModel as never));
    await waitFor(() => expect(second.result.current.extensions).toHaveLength(1));
    expect(warn).not.toHaveBeenCalled();
  });

  it("takes its contributions back when the connection drops", async () => {
    const { client, windowModel } = fakes();
    const { result, rerender } = renderHook(({ connected }) => useExtensions(client as never, connected, windowModel as never), {
      initialProps: { connected: true },
    });
    await waitFor(() => expect(result.current.contributions.pages.has("kb")).toBe(true));
    rerender({ connected: false });
    expect(result.current.contributions.pages.has("kb")).toBe(false);
  });
});
