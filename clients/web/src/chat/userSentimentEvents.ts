/**
 * The window event the push-channel router dispatches when Laya reads a
 * person's message as pleased or displeased with igni, and the hook a view
 * subscribes to it with.
 */

import { useEffect, useRef } from "react";

import type { UserSentiment } from "../protocol/pushChannels";

export const USER_SENTIMENT_EVENT = "ember:user_sentiment";

/** The person's message in ``sessionId`` was pleased or displeased with igni. */
export class UserSentimentEvent extends Event {
  readonly sessionId: string;
  readonly sentiment: UserSentiment["sentiment"];
  readonly confidence: number;
  readonly messageRunId: string | null;
  readonly replyRunId: string | null;
  readonly aspects: UserSentiment["aspects"];

  constructor(push: Omit<UserSentiment, "channel">) {
    super(USER_SENTIMENT_EVENT);
    this.sessionId = push.sessionId;
    this.sentiment = push.sentiment;
    this.confidence = push.confidence;
    this.messageRunId = push.messageRunId;
    this.replyRunId = push.replyRunId;
    this.aspects = push.aspects;
  }
}

/** Calls ``onSentiment`` each time the chat ``sessionId`` is pleased or displeased with igni. */
export function useUserSentiment(
  sessionId: string,
  onSentiment: (ev: UserSentimentEvent) => void,
  target: EventTarget = window,
): void {
  const latest = useRef(onSentiment);
  latest.current = onSentiment;

  useEffect(() => {
    const listener = (e: Event) => {
      if (e instanceof UserSentimentEvent && e.sessionId === sessionId) latest.current(e);
    };
    target.addEventListener(USER_SENTIMENT_EVENT, listener);
    return () => target.removeEventListener(USER_SENTIMENT_EVENT, listener);
  }, [sessionId, target]);
}
