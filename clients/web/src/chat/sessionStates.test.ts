// @vitest-environment jsdom
/**
 * The chats' states: asked once on connect, moved only by the push, and
 * the chat on screen marked seen whenever it has news and the window is
 * visible — once per finish.
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STATES_CHANNEL, SessionStates, useSessionStates } from "./sessionStates";

afterEach(() => {
  cleanup();
  setHidden(false);
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

function row(session_id: string, state = "idle", unread = false) {
  return { session_id, state, waiting_approvals: state === "waiting" ? 1 : 0, unread };
}

function push(sessions: unknown[], cause = "activity") {
  return { type: "push_notification", channel: STATES_CHANNEL, payload: { sessions, cause } };
}

function backend(initial: unknown = { sessions: [], cause: "activity" }) {
  const listeners = new Set<(m: unknown) => void>();
  const rpc = vi.fn(async (method: string, _args?: unknown) =>
    method === "list_session_states" ? initial : { sessions: [], cause: "seen" },
  );
  const client = {
    rpc,
    onEvent: (fn: (m: unknown) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const send = (message: unknown) => {
    for (const fn of listeners) fn(message);
  };
  const marks = () => rpc.mock.calls.filter(([m]) => m === "mark_session_seen").map(([, a]) => a);
  return { client: client as never, rpc, send, marks };
}

describe("SessionStates", () => {
  it("reads each chat's activity and mark", () => {
    const states = SessionStates.parse({
      sessions: [row("a", "running"), row("b", "waiting"), row("c", "idle", true)],
    });

    expect(states?.of("a")).toEqual({ activity: "running", unread: false });
    expect(states?.of("b")).toEqual({ activity: "waiting", unread: false });
    expect(states?.of("c")).toEqual({ activity: "idle", unread: true });
  });

  it("says a chat it does not list is idle and read", () => {
    expect(SessionStates.NONE.of("x")).toEqual({ activity: "idle", unread: false });
  });

  it("takes an unknown state as idle, and only a plain true as unread", () => {
    const states = SessionStates.parse({
      sessions: [{ session_id: "a", state: "dreaming", unread: "yes" }, { state: "running" }],
    });

    expect(states?.of("a")).toEqual({ activity: "idle", unread: false });
    expect(states?.of("")).toEqual({ activity: "idle", unread: false });
  });

  it("refuses what is not the shape", () => {
    expect(SessionStates.parse(null)).toBeNull();
    expect(SessionStates.parse({ sessions: "no" })).toBeNull();
  });

  it("reads only its own push", () => {
    expect(SessionStates.fromPush(push([row("a", "running")]) as never)?.of("a").activity).toBe(
      "running",
    );
    expect(
      SessionStates.fromPush({ type: "push_notification", channel: "other", payload: {} } as never),
    ).toBeNull();
    expect(SessionStates.fromPush({ type: "run_started" } as never)).toBeNull();
  });
});

describe("useSessionStates", () => {
  it("asks once when connected", async () => {
    const { client, rpc } = backend({ sessions: [row("a", "running")] });

    const { result } = renderHook(() => useSessionStates(client, true, ""));

    await waitFor(() => expect(result.current.of("a").activity).toBe("running"));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_session_states");
  });

  it("asks nothing before there is a connection", () => {
    const { client, rpc } = backend();

    const { result } = renderHook(() => useSessionStates(client, false, "a"));

    expect(rpc).not.toHaveBeenCalled();
    expect(result.current).toBe(SessionStates.NONE);
  });

  it("keeps no mark when the backend cannot say", async () => {
    const { client, rpc } = backend();
    rpc.mockRejectedValueOnce(new Error("unknown method"));

    const { result } = renderHook(() => useSessionStates(client, true, ""));

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(result.current).toBe(SessionStates.NONE);
  });

  it("keeps a push that lands before the answer to its first ask", async () => {
    let answer: (value: unknown) => void = () => {};
    const { client, rpc, send } = backend();
    rpc.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useSessionStates(client, true, ""));

    act(() => send(push([row("a", "running")])));
    await act(async () => answer({ sessions: [], cause: "activity" }));

    expect(result.current.of("a").activity).toBe("running");
  });

  it("moves with the push", async () => {
    const { client, rpc, send } = backend();
    const { result } = renderHook(() => useSessionStates(client, true, ""));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    act(() => send(push([row("a", "running")])));
    expect(result.current.of("a").activity).toBe("running");

    act(() => send(push([row("a", "idle", true)])));
    expect(result.current.of("a")).toEqual({ activity: "idle", unread: true });
  });

  it("marks the chat on screen seen when it has news, once", async () => {
    const { client, send, marks } = backend();
    renderHook(() => useSessionStates(client, true, "a"));

    act(() => send(push([row("a", "idle", true)])));
    act(() => send(push([row("a", "idle", true), row("b", "running")])));

    await waitFor(() => expect(marks()).toEqual([{ session_id: "a" }]));
  });

  it("marks it again after a later finish", async () => {
    const { client, send, marks } = backend();
    renderHook(() => useSessionStates(client, true, "a"));

    act(() => send(push([row("a", "idle", true)])));
    act(() => send(push([], "seen")));
    act(() => send(push([row("a", "idle", true)])));

    await waitFor(() => expect(marks()).toHaveLength(2));
  });

  it("does not mark a chat that is not on screen", async () => {
    const { client, send, marks, rpc } = backend();
    renderHook(() => useSessionStates(client, true, "a"));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    act(() => send(push([row("b", "idle", true)])));

    expect(marks()).toEqual([]);
  });

  it("waits for a hidden window to be shown", async () => {
    setHidden(true);
    const { client, send, marks } = backend();
    renderHook(() => useSessionStates(client, true, "a"));

    act(() => send(push([row("a", "idle", true)])));
    expect(marks()).toEqual([]);

    setHidden(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(marks()).toEqual([{ session_id: "a" }]));
  });

  it("marks the chat it switches to when that one has news", async () => {
    const { client, send, marks } = backend();
    const { rerender } = renderHook(({ id }) => useSessionStates(client, true, id), {
      initialProps: { id: "a" },
    });
    act(() => send(push([row("b", "idle", true)])));
    expect(marks()).toEqual([]);

    rerender({ id: "b" });

    await waitFor(() => expect(marks()).toEqual([{ session_id: "b" }]));
  });

  it("asks again when a mark failed", async () => {
    const { client, send, marks, rpc } = backend();
    rpc.mockImplementation(async (method: string) => {
      if (method === "mark_session_seen" && marks().length === 1) throw new Error("gone");
      return { sessions: [], cause: "seen" };
    });
    renderHook(() => useSessionStates(client, true, "a"));

    act(() => send(push([row("a", "idle", true)])));
    await waitFor(() => expect(marks()).toHaveLength(1));
    await act(async () => {});
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(marks()).toHaveLength(2));
  });
});
