// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { emptyWindowState, type WindowState } from "../clientState";
import { useWindowPlace } from "./useWindowPlace";

afterEach(cleanup);

function model() {
  let state: WindowState = emptyWindowState();
  const listeners = new Set<() => void>();
  return {
    get: <K extends keyof WindowState>(field: K) => state[field],
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    move(patch: Partial<WindowState>) {
      state = { ...state, ...patch };
      listeners.forEach((fn) => fn());
    },
  };
}

describe("useWindowPlace", () => {
  it("follows the session and folder the model moves to", () => {
    const m = model();
    const hook = renderHook(() => useWindowPlace(m as never));
    act(() => m.move({ session: "s1", project_dir: "/work" }));
    expect(hook.result.current.sessionId).toBe("s1");
    expect(hook.result.current.projectDir).toBe("/work");
  });
});
