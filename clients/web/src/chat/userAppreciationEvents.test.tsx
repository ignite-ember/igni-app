// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import {
  USER_APPRECIATION_EVENT,
  UserAppreciationEvent,
  useUserAppreciation,
} from "./userAppreciationEvents";

afterEach(cleanup);

describe("UserAppreciationEvent", () => {
  it("carries the session and the kind under its own event name", () => {
    const ev = new UserAppreciationEvent("s1", "compliment");
    expect(ev.type).toBe(USER_APPRECIATION_EVENT);
    expect(USER_APPRECIATION_EVENT).toBe("ember:user_appreciation");
    expect([ev.sessionId, ev.kind]).toEqual(["s1", "compliment"]);
  });
});

describe("useUserAppreciation", () => {
  it("hears its own chat's appreciation, on the window by default", () => {
    const heard = vi.fn();
    renderHook(() => useUserAppreciation("s1", heard));
    const ev = new UserAppreciationEvent("s1", "gratitude");
    window.dispatchEvent(ev);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(ev);
  });

  it("ignores another chat's, and a plain event under the same name", () => {
    const heard = vi.fn();
    renderHook(() => useUserAppreciation("s1", heard));
    window.dispatchEvent(new UserAppreciationEvent("s2", "gratitude"));
    window.dispatchEvent(new Event(USER_APPRECIATION_EVENT));
    expect(heard).not.toHaveBeenCalled();
  });

  it("follows the chat it is given", () => {
    const heard = vi.fn();
    const target = new EventTarget();
    const hook = renderHook(({ id }) => useUserAppreciation(id, heard, target), {
      initialProps: { id: "s1" },
    });
    hook.rerender({ id: "s2" });
    target.dispatchEvent(new UserAppreciationEvent("s1", "gratitude"));
    target.dispatchEvent(new UserAppreciationEvent("s2", "compliment"));
    expect(heard.mock.calls.map(([ev]) => ev.sessionId)).toEqual(["s2"]);
  });

  it("calls the latest callback without subscribing again", () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ cb }) => useUserAppreciation("s1", cb, target), {
      initialProps: { cb: first },
    });
    hook.rerender({ cb: second });
    target.dispatchEvent(new UserAppreciationEvent("s1", "gratitude"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("stops listening once unmounted", () => {
    const heard = vi.fn();
    const target = new EventTarget();
    const hook = renderHook(() => useUserAppreciation("s1", heard, target));
    hook.unmount();
    target.dispatchEvent(new UserAppreciationEvent("s1", "gratitude"));
    expect(heard).not.toHaveBeenCalled();
  });
});
