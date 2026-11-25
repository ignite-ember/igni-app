// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import {
  USER_SENTIMENT_EVENT,
  UserSentimentEvent,
  useUserSentiment,
} from "./userSentimentEvents";

afterEach(cleanup);

function sentiment(sessionId: string, value: "positive" | "negative" = "positive"): UserSentimentEvent {
  return new UserSentimentEvent({
    sessionId,
    sentiment: value,
    confidence: 0.9,
    messageRunId: "r-2",
    replyRunId: "r-1",
  });
}

describe("UserSentimentEvent", () => {
  it("carries the session, the sentiment, the confidence and the runs under its own event name", () => {
    const ev = new UserSentimentEvent({
      sessionId: "s1",
      sentiment: "negative",
      confidence: 0.84,
      messageRunId: "r-2",
      replyRunId: null,
    });
    expect(ev.type).toBe(USER_SENTIMENT_EVENT);
    expect(USER_SENTIMENT_EVENT).toBe("ember:user_sentiment");
    expect([ev.sessionId, ev.sentiment, ev.confidence, ev.messageRunId, ev.replyRunId]).toEqual([
      "s1",
      "negative",
      0.84,
      "r-2",
      null,
    ]);
  });
});

describe("useUserSentiment", () => {
  it("hears its own chat's sentiment, on the window by default", () => {
    const heard = vi.fn();
    renderHook(() => useUserSentiment("s1", heard));
    const ev = sentiment("s1");
    window.dispatchEvent(ev);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(ev);
  });

  it("ignores another chat's, and a plain event under the same name", () => {
    const heard = vi.fn();
    renderHook(() => useUserSentiment("s1", heard));
    window.dispatchEvent(sentiment("s2"));
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
    target.dispatchEvent(sentiment("s1"));
    target.dispatchEvent(sentiment("s2"));
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
    target.dispatchEvent(sentiment("s1"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("stops listening once unmounted", () => {
    const heard = vi.fn();
    const target = new EventTarget();
    const hook = renderHook(() => useUserSentiment("s1", heard, target));
    hook.unmount();
    target.dispatchEvent(sentiment("s1"));
    expect(heard).not.toHaveBeenCalled();
  });
});
