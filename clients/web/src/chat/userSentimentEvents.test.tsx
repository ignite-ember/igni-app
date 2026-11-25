// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import {
  USER_SENTIMENT_EVENT,
  UserSentimentEvent,
  useUserSentiment,
} from "./userSentimentEvents";

afterEach(cleanup);

describe("UserSentimentEvent", () => {
  it("carries the session and the kind under its own event name", () => {
    const ev = new UserSentimentEvent("s1", "compliment");
    expect(ev.type).toBe(USER_SENTIMENT_EVENT);
    expect(USER_SENTIMENT_EVENT).toBe("ember:user_sentiment");
    expect([ev.sessionId, ev.kind]).toEqual(["s1", "compliment"]);
  });
});

describe("useUserSentiment", () => {
  it("hears its own chat's sentiment, on the window by default", () => {
    const heard = vi.fn();
    renderHook(() => useUserSentiment("s1", heard));
    const ev = new UserSentimentEvent("s1", "gratitude");
    window.dispatchEvent(ev);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(ev);
  });

  it("ignores another chat's, and a plain event under the same name", () => {
    const heard = vi.fn();
    renderHook(() => useUserSentiment("s1", heard));
    window.dispatchEvent(new UserSentimentEvent("s2", "gratitude"));
    window.dispatchEvent(new Event(USER_SENTIMENT_EVENT));
    expect(heard).not.toHaveBeenCalled();
  });

  it("follows the chat it is given", () => {
    const heard = vi.fn();
    const target = new EventTarget();
    const hook = renderHook(({ id }) => useUserSentiment(id, heard, target), {
      initialProps: { id: "s1" },
    });
    hook.rerender({ id: "s2" });
    target.dispatchEvent(new UserSentimentEvent("s1", "gratitude"));
    target.dispatchEvent(new UserSentimentEvent("s2", "compliment"));
    expect(heard.mock.calls.map(([ev]) => ev.sessionId)).toEqual(["s2"]);
  });

  it("calls the latest callback without subscribing again", () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(({ cb }) => useUserSentiment("s1", cb, target), {
      initialProps: { cb: first },
    });
    hook.rerender({ cb: second });
    target.dispatchEvent(new UserSentimentEvent("s1", "gratitude"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("stops listening once unmounted", () => {
    const heard = vi.fn();
    const target = new EventTarget();
    const hook = renderHook(() => useUserSentiment("s1", heard, target));
    hook.unmount();
    target.dispatchEvent(new UserSentimentEvent("s1", "gratitude"));
    expect(heard).not.toHaveBeenCalled();
  });
});
