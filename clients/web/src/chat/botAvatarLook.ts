/**
 * What the sidebar's cat shows: the open chat's run first, then what the
 * other chats are doing, with two short moments on top — a celebration
 * when a long run finishes, and an alarm when a run fails — and a
 * reaction to how the person's message feels about igni: a smile when
 * pleased, closed eyes when displeased.
 */

import { useEffect, useRef, useState } from "react";
import type { AvatarMood, AvatarState } from "open-bot-avatar";

import type { RunPhase } from "./runPhase";
import type { ChatActivity, SessionStates } from "./sessionStates";
import type { Sentiment } from "../protocol/pushChannels";
import { useUserSentiment } from "./userSentimentEvents";

/** A run at least this long earns a celebration when it finishes. */
export const LONG_RUN_MS = 15_000;
/** How long the celebration lasts. */
export const DONE_MS = 4_000;
/** How long a failed run keeps the alarm up. */
export const BLOCKED_MS = 6_000;
/** How long the cat smiles after the person is pleased with igni. */
export const PLEASED_MS = 3_000;
/** How long the cat closes its eyes after the person is displeased with igni. */
export const DISPLEASED_MS = 3_000;

export interface AvatarLook {
  state: AvatarState;
  mood: AvatarMood;
}

/** A short-lived look that outranks the other chats, not the open one's run. */
export type AvatarMoment = "done" | "blocked";

/** How the cat takes the person's last message to igni, for a few seconds. */
export type AvatarReaction = "pleased" | "displeased";

const IDLE: AvatarLook = { state: "idle", mood: "neutral" };

/** The look for the open chat's ``phase``, the other chats' activity, the moment, and the reaction.
 *  A reaction outranks everything but a failed run's alarm — even the run its message started:
 *  pleased makes the look happy, displeased closes the cat's eyes (``waiting``). */
export function avatarLook(
  phase: RunPhase,
  elsewhere: ChatActivity,
  moment: AvatarMoment | null,
  reaction: AvatarReaction | null = null,
): AvatarLook {
  const look = baseLook(phase, elsewhere, moment);
  if (reaction === null || look.state === "blocked") return look;
  if (reaction === "displeased") return { state: "waiting", mood: "neutral" };
  return { ...look, mood: "happy" };
}

function baseLook(phase: RunPhase, elsewhere: ChatActivity, moment: AvatarMoment | null): AvatarLook {
  if (phase === "awaiting_approval") return { state: "waiting", mood: "neutral" };
  if (phase === "starting") return { state: "thinking", mood: "neutral" };
  if (phase === "streaming" || phase === "finalizing") return { state: "working", mood: "neutral" };
  if (moment === "blocked") return { state: "blocked", mood: "neutral" };
  if (moment === "done") return { state: "done", mood: "happy" };
  if (elsewhere === "waiting") return { state: "waiting", mood: "neutral" };
  if (elsewhere === "running") return { state: "working", mood: "neutral" };
  return IDLE;
}

const RUNNING: ReadonlySet<RunPhase> = new Set<RunPhase>([
  "starting",
  "streaming",
  "finalizing",
  "awaiting_approval",
]);

/** When runs began, and the moment their end earned. Times are milliseconds. */
export class AvatarMoments {
  private runStart: number | null = null;
  private readonly othersStart = new Map<string, number>();
  private moment: { kind: AvatarMoment; until: number } | null = null;
  private reacted: { kind: AvatarReaction; until: number } | null = null;

  /** The open chat's run moved to ``phase``. */
  phase(phase: RunPhase, now: number): void {
    if (RUNNING.has(phase)) {
      this.runStart ??= now;
      return;
    }
    const began = this.runStart;
    this.runStart = null;
    if (phase === "errored") this.moment = { kind: "blocked", until: now + BLOCKED_MS };
    else if (phase === "done" && began !== null && now - began >= LONG_RUN_MS) this.celebrate(now);
  }

  /** The chats' states moved: a long run that finished elsewhere is celebrated. */
  chats(states: SessionStates, currentId: string, now: number): void {
    const active = new Set(states.activeElsewhere(currentId));
    for (const id of active) if (!this.othersStart.has(id)) this.othersStart.set(id, now);
    for (const [id, began] of this.othersStart) {
      if (active.has(id)) continue;
      this.othersStart.delete(id);
      // A chat opened mid-run left "elsewhere" without finishing.
      const finished = id !== currentId && states.of(id).activity === "idle";
      if (finished && now - began >= LONG_RUN_MS) this.celebrate(now);
    }
  }

  /** The person's message in the open chat was pleased or displeased with igni; the latest wins. */
  react(sentiment: Sentiment, now: number): void {
    this.reacted =
      sentiment === "negative"
        ? { kind: "displeased", until: now + DISPLEASED_MS }
        : { kind: "pleased", until: now + PLEASED_MS };
  }

  /** The reaction showing at ``now``, if any. */
  reaction(now: number): AvatarReaction | null {
    return this.reacted && now < this.reacted.until ? this.reacted.kind : null;
  }

  /** The moment showing at ``now``, if any. */
  current(now: number): AvatarMoment | null {
    return this.moment && now < this.moment.until ? this.moment.kind : null;
  }

  /** Milliseconds until the moment or the reaction ends, whichever is first, or ``null`` when neither shows. */
  remaining(now: number): number | null {
    const ends = [this.moment?.until, this.reacted?.until].filter(
      (until): until is number => until != null && now < until,
    );
    return ends.length > 0 ? Math.min(...ends) - now : null;
  }

  private celebrate(now: number): void {
    if (this.moment?.kind === "blocked" && now < this.moment.until) return;
    this.moment = { kind: "done", until: now + DONE_MS };
  }
}

/** The cat's look, kept current by the run and the chats' states. */
export function useBotAvatarLook(
  phase: RunPhase,
  states: SessionStates,
  currentId: string,
): AvatarLook {
  const moments = useRef(new AvatarMoments());
  const [moment, setMoment] = useState<AvatarMoment | null>(null);
  const [reaction, setReaction] = useState<AvatarReaction | null>(null);
  const [tick, setTick] = useState(0);

  useUserSentiment(currentId, (ev) => {
    moments.current.react(ev.sentiment, Date.now());
    setTick((t) => t + 1);
  });

  useEffect(() => {
    moments.current.phase(phase, Date.now());
    setTick((t) => t + 1);
  }, [phase]);

  useEffect(() => {
    moments.current.chats(states, currentId, Date.now());
    setTick((t) => t + 1);
  }, [states, currentId]);

  useEffect(() => {
    const now = Date.now();
    setMoment(moments.current.current(now));
    setReaction(moments.current.reaction(now));
    const left = moments.current.remaining(now);
    if (left === null) return;
    const timer = window.setTimeout(() => setTick((t) => t + 1), left);
    return () => window.clearTimeout(timer);
  }, [tick]);

  return avatarLook(phase, states.elsewhere(currentId), moment, reaction);
}
