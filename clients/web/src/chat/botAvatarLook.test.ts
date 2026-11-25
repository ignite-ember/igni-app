// @vitest-environment jsdom
/**
 * The sidebar cat's look: the open chat's run first, then the other
 * chats, with a celebration after a long run and an alarm after a
 * failed one, each gone after its few seconds, and a reaction to how the
 * person's message feels about igni: a smile, or closed eyes.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PLEASED_MS,
  AvatarMoments,
  BLOCKED_MS,
  DONE_MS,
  DISPLEASED_MS,
  LONG_RUN_MS,
  avatarLook,
  useBotAvatarLook,
} from "./botAvatarLook";
import type { RunPhase } from "./runPhase";
import { SessionStates } from "./sessionStates";
import { UserSentimentEvent } from "./userSentimentEvents";

function sentimentEvent(sessionId: string, sentiment: "positive" | "negative"): UserSentimentEvent {
  return new UserSentimentEvent({ sessionId, sentiment, confidence: 0.9, messageRunId: "r-2", replyRunId: "r-1" });
}

function states(...rows: [string, string][]): SessionStates {
  const parsed = SessionStates.parse({
    sessions: rows.map(([session_id, state]) => ({ session_id, state, unread: false })),
  });
  if (!parsed) throw new Error("not states");
  return parsed;
}

describe("avatarLook", () => {
  it.each<[RunPhase, string]>([
    ["starting", "thinking"],
    ["streaming", "working"],
    ["finalizing", "working"],
    ["awaiting_approval", "waiting"],
  ])("the open chat's %s shows %s, over the other chats and any moment", (phase, state) => {
    expect(avatarLook(phase, "waiting", "done")).toEqual({ state, mood: "neutral" });
  });

  it("a failed run's alarm outranks a celebration and the other chats", () => {
    expect(avatarLook("idle", "waiting", "blocked")).toEqual({ state: "blocked", mood: "neutral" });
  });

  it("a celebration is done and happy, over the other chats", () => {
    expect(avatarLook("done", "running", "done")).toEqual({ state: "done", mood: "happy" });
  });

  it("with the open chat idle, another chat waiting shows waiting, running shows working", () => {
    expect(avatarLook("idle", "waiting", null).state).toBe("waiting");
    expect(avatarLook("cancelled", "running", null).state).toBe("working");
  });

  it("nothing going on is idle and neutral", () => {
    expect(avatarLook("done", "idle", null)).toEqual({ state: "idle", mood: "neutral" });
    expect(avatarLook("done", "idle", null, null)).toEqual({ state: "idle", mood: "neutral" });
  });

  it.each<[RunPhase, string]>([
    ["starting", "thinking"],
    ["streaming", "working"],
    ["awaiting_approval", "waiting"],
    ["idle", "idle"],
  ])("thanks keeps the open chat's %s look (%s) and makes it happy", (phase, state) => {
    expect(avatarLook(phase, "idle", null, "pleased")).toEqual({ state, mood: "happy" });
  });

  it("thanks makes the other chats' look and a celebration happy too", () => {
    expect(avatarLook("idle", "running", null, "pleased")).toEqual({ state: "working", mood: "happy" });
    expect(avatarLook("done", "idle", "done", "pleased")).toEqual({ state: "done", mood: "happy" });
  });

  it.each<RunPhase>(["starting", "streaming", "awaiting_approval", "idle", "done"])(
    "displeasure closes the cat's eyes over the open chat's %s, the other chats and a celebration",
    (phase) => {
      expect(avatarLook(phase, "running", "done", "displeased")).toEqual({ state: "waiting", mood: "neutral" });
    },
  );

  it("no reaction shows over a failed run's alarm", () => {
    expect(avatarLook("errored", "idle", "blocked", "pleased")).toEqual({ state: "blocked", mood: "neutral" });
    expect(avatarLook("errored", "idle", "blocked", "displeased")).toEqual({ state: "blocked", mood: "neutral" });
  });
});

describe("SessionStates.elsewhere", () => {
  it("ignores the open chat and idle ones", () => {
    const s = states(["a", "running"], ["b", "idle"]);
    expect(s.activeElsewhere("a")).toEqual([]);
    expect(s.elsewhere("a")).toBe("idle");
  });

  it("is waiting when any other chat waits, even beside a running one", () => {
    const s = states(["a", "running"], ["b", "waiting"], ["c", "running"]);
    expect(s.activeElsewhere("x").sort()).toEqual(["a", "b", "c"]);
    expect(s.elsewhere("x")).toBe("waiting");
  });

  it("is running when others only run", () => {
    expect(states(["a", "running"]).elsewhere("x")).toBe("running");
  });
});

describe("AvatarMoments", () => {
  it("celebrates the open chat's run when it lasted the long-run time", () => {
    const m = new AvatarMoments();
    m.phase("starting", 0);
    m.phase("streaming", 1_000);
    m.phase("done", LONG_RUN_MS);
    expect(m.current(LONG_RUN_MS)).toBe("done");
    expect(m.remaining(LONG_RUN_MS)).toBe(DONE_MS);
    expect(m.current(LONG_RUN_MS + DONE_MS - 1)).toBe("done");
    expect(m.current(LONG_RUN_MS + DONE_MS)).toBeNull();
    expect(m.remaining(LONG_RUN_MS + DONE_MS)).toBeNull();
  });

  it("does not celebrate a short run", () => {
    const m = new AvatarMoments();
    m.phase("starting", 0);
    m.phase("done", LONG_RUN_MS - 1);
    expect(m.current(LONG_RUN_MS - 1)).toBeNull();
  });

  it("times the run from its first active phase, not its last", () => {
    const m = new AvatarMoments();
    m.phase("starting", 0);
    m.phase("awaiting_approval", LONG_RUN_MS - 100);
    m.phase("streaming", LONG_RUN_MS - 50);
    m.phase("done", LONG_RUN_MS);
    expect(m.current(LONG_RUN_MS)).toBe("done");
  });

  it("does not celebrate a cancelled run, and a new run starts its own clock", () => {
    const m = new AvatarMoments();
    m.phase("starting", 0);
    m.phase("cancelled", LONG_RUN_MS);
    m.phase("starting", LONG_RUN_MS + 1);
    m.phase("done", LONG_RUN_MS + 2);
    expect(m.current(LONG_RUN_MS + 2)).toBeNull();
  });

  it("a done with no run seen is not celebrated", () => {
    const m = new AvatarMoments();
    m.phase("done", LONG_RUN_MS * 2);
    expect(m.current(LONG_RUN_MS * 2)).toBeNull();
  });

  it("raises the alarm for a failed run, however short, for its few seconds", () => {
    const m = new AvatarMoments();
    m.phase("starting", 0);
    m.phase("errored", 10);
    expect(m.current(10)).toBe("blocked");
    expect(m.current(10 + BLOCKED_MS - 1)).toBe("blocked");
    expect(m.current(10 + BLOCKED_MS)).toBeNull();
  });

  it("a celebration elsewhere does not hide a showing alarm", () => {
    const m = new AvatarMoments();
    m.chats(states(["b", "running"]), "a", 0);
    m.phase("starting", LONG_RUN_MS);
    m.phase("errored", LONG_RUN_MS);
    m.chats(states(["b", "idle"]), "a", LONG_RUN_MS + 1);
    expect(m.current(LONG_RUN_MS + 1)).toBe("blocked");
  });

  it("celebrates a long run another chat finished", () => {
    const m = new AvatarMoments();
    m.chats(states(["b", "running"]), "a", 0);
    m.chats(states(["b", "waiting"]), "a", 5_000);
    m.chats(states(["b", "idle"]), "a", LONG_RUN_MS);
    expect(m.current(LONG_RUN_MS)).toBe("done");
  });

  it("does not celebrate a short run elsewhere", () => {
    const m = new AvatarMoments();
    m.chats(states(["b", "running"]), "a", 0);
    m.chats(states(), "a", LONG_RUN_MS - 1);
    expect(m.current(LONG_RUN_MS - 1)).toBeNull();
  });

  it.each<["positive", string]>([["positive", "pleased"]])("smiles when %s for three seconds", (kind, reaction) => {
    expect(PLEASED_MS).toBe(3_000);
    const m = new AvatarMoments();
    expect(m.reaction(0)).toBeNull();
    m.react(kind, 100);
    expect(m.reaction(100)).toBe(reaction);
    expect(m.remaining(100)).toBe(PLEASED_MS);
    expect(m.reaction(100 + PLEASED_MS - 1)).toBe(reaction);
    expect(m.reaction(100 + PLEASED_MS)).toBeNull();
    expect(m.remaining(100 + PLEASED_MS)).toBeNull();
    expect(m.current(100)).toBeNull();
  });

  it("closes its eyes when displeased for three seconds", () => {
    expect(DISPLEASED_MS).toBe(3_000);
    const m = new AvatarMoments();
    m.react("negative", 100);
    expect(m.reaction(100)).toBe("displeased");
    expect(m.remaining(100)).toBe(DISPLEASED_MS);
    expect(m.reaction(100 + DISPLEASED_MS - 1)).toBe("displeased");
    expect(m.reaction(100 + DISPLEASED_MS)).toBeNull();
  });

  it("the same reaction again starts its three seconds again", () => {
    const m = new AvatarMoments();
    m.react("positive", 0);
    m.react("positive", 2_000);
    expect(m.reaction(PLEASED_MS + 1_000)).toBe("pleased");
    expect(m.reaction(2_000 + PLEASED_MS)).toBeNull();
    m.react("negative", 10_000);
    m.react("negative", 12_000);
    expect(m.reaction(10_000 + DISPLEASED_MS)).toBe("displeased");
    expect(m.reaction(12_000 + DISPLEASED_MS)).toBeNull();
  });

  it("the latest reaction replaces the one before", () => {
    const m = new AvatarMoments();
    m.react("negative", 0);
    m.react("positive", 1_000);
    expect(m.reaction(1_000)).toBe("pleased");
    m.react("negative", 2_000);
    expect(m.reaction(2_000)).toBe("displeased");
    expect(m.reaction(2_000 + DISPLEASED_MS)).toBeNull();
  });

  it("counts down to whichever ends first, the reaction or the moment, and leaves the moment be", () => {
    const m = new AvatarMoments();
    m.phase("starting", 0);
    m.phase("done", LONG_RUN_MS);
    m.react("positive", LONG_RUN_MS);
    expect(m.remaining(LONG_RUN_MS)).toBe(PLEASED_MS);
    expect(m.current(LONG_RUN_MS)).toBe("done");
    expect(m.remaining(LONG_RUN_MS + PLEASED_MS)).toBe(DONE_MS - PLEASED_MS);
    expect(m.current(LONG_RUN_MS + PLEASED_MS)).toBe("done");

    const late = new AvatarMoments();
    late.phase("starting", 0);
    late.phase("errored", 0);
    late.react("negative", BLOCKED_MS - 1_000);
    expect(late.remaining(BLOCKED_MS - 1_000)).toBe(1_000);
    expect(late.remaining(BLOCKED_MS)).toBe(DISPLEASED_MS - 1_000);
  });

  it("does not celebrate a chat that was opened mid-run", () => {
    const m = new AvatarMoments();
    m.chats(states(["b", "running"]), "a", 0);
    m.chats(states(["b", "running"]), "b", LONG_RUN_MS);
    expect(m.current(LONG_RUN_MS)).toBeNull();
  });
});

describe("useBotAvatarLook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("follows the run, celebrates a long one, and settles back to idle", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: RunPhase }) => useBotAvatarLook(phase, SessionStates.NONE, "a"),
      { initialProps: { phase: "idle" as RunPhase } },
    );
    expect(result.current.state).toBe("idle");

    rerender({ phase: "starting" });
    expect(result.current.state).toBe("thinking");
    rerender({ phase: "streaming" });
    expect(result.current.state).toBe("working");

    act(() => vi.setSystemTime(LONG_RUN_MS));
    rerender({ phase: "done" });
    expect(result.current).toEqual({ state: "done", mood: "happy" });

    act(() => {
      vi.advanceTimersByTime(DONE_MS);
    });
    expect(result.current).toEqual({ state: "idle", mood: "neutral" });
  });

  it("smiles for thanks in the open chat while it works, then stops after three seconds", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: RunPhase }) => useBotAvatarLook(phase, SessionStates.NONE, "a"),
      { initialProps: { phase: "idle" as RunPhase } },
    );
    rerender({ phase: "streaming" });
    act(() => {
      window.dispatchEvent(sentimentEvent("a", "positive"));
    });
    expect(result.current).toEqual({ state: "working", mood: "happy" });

    act(() => {
      vi.advanceTimersByTime(PLEASED_MS - 1);
    });
    expect(result.current).toEqual({ state: "working", mood: "happy" });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual({ state: "working", mood: "neutral" });
  });

  it("closes its eyes when displeased while the run its message started works, then works again", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: RunPhase }) => useBotAvatarLook(phase, SessionStates.NONE, "a"),
      { initialProps: { phase: "idle" as RunPhase } },
    );
    rerender({ phase: "starting" });
    act(() => {
      window.dispatchEvent(sentimentEvent("a", "negative"));
    });
    expect(result.current).toEqual({ state: "waiting", mood: "neutral" });
    rerender({ phase: "streaming" });
    expect(result.current).toEqual({ state: "waiting", mood: "neutral" });

    act(() => {
      vi.advanceTimersByTime(DISPLEASED_MS);
    });
    expect(result.current).toEqual({ state: "working", mood: "neutral" });
  });

  it("does not react to another chat", () => {
    const { result } = renderHook(() => useBotAvatarLook("idle", SessionStates.NONE, "a"));
    act(() => {
      window.dispatchEvent(sentimentEvent("b", "positive"));
    });
    expect(result.current).toEqual({ state: "idle", mood: "neutral" });
  });

  it("shows another chat's work while the open one is idle", () => {
    const { result, rerender } = renderHook(
      ({ s }: { s: SessionStates }) => useBotAvatarLook("idle", s, "a"),
      { initialProps: { s: SessionStates.NONE } },
    );
    rerender({ s: states(["b", "running"]) });
    expect(result.current.state).toBe("working");
    rerender({ s: states(["b", "waiting"]) });
    expect(result.current.state).toBe("waiting");
  });
});
