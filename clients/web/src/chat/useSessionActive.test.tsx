// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import { SessionStates } from "./sessionStates";
import { useSessionActive } from "./useRunPhase";

afterEach(cleanup);

function states(rows: { session_id: string; state: string }[]): SessionStates {
  return SessionStates.parse({ sessions: rows }) ?? SessionStates.NONE;
}

function follow(initial: SessionStates, sessionId = "s1") {
  const controls = { sessionActiveRef: { current: false } };
  const hook = renderHook(({ s, id }) => useSessionActive(controls, s, id), {
    initialProps: { s: initial, id: sessionId },
  });
  return { hook, controls };
}

describe("useSessionActive", () => {
  it.each(["running", "waiting"])("a chat %s on the backend is active, for Stop and Escape", (state) => {
    const { hook, controls } = follow(states([{ session_id: "s1", state }]));
    expect(hook.result.current).toBe(true);
    expect(controls.sessionActiveRef.current).toBe(true);
  });

  it("an idle chat, or one not listed, is not", () => {
    const { hook, controls } = follow(states([{ session_id: "s1", state: "idle" }]));
    expect(hook.result.current).toBe(false);
    expect(controls.sessionActiveRef.current).toBe(false);
  });

  it("another chat's run is not this chat's", () => {
    const { hook, controls } = follow(states([{ session_id: "s2", state: "running" }]));
    expect(hook.result.current).toBe(false);
    expect(controls.sessionActiveRef.current).toBe(false);
  });

  it("follows the pushes: active while the run goes on, idle once it is over", () => {
    const { hook, controls } = follow(states([{ session_id: "s1", state: "running" }]));
    hook.rerender({ s: states([]), id: "s1" });
    expect(hook.result.current).toBe(false);
    expect(controls.sessionActiveRef.current).toBe(false);
  });

  it("a window bound to no session yet is not active", () => {
    const { hook } = follow(states([{ session_id: "", state: "running" }]), "");
    expect(hook.result.current).toBe(false);
  });
});
