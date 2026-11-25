/**
 * The window event the push-channel router dispatches when Laya reads a
 * person's message as thanks, praise or an insult for igni, and the hook a view
 * subscribes to it with.
 */

import { useEffect, useRef } from "react";

import type { SentimentKind } from "../protocol/pushChannels";

export const USER_SENTIMENT_EVENT = "ember:user_sentiment";

/** The person's message in ``sessionId`` thanked, praised or insulted igni. */
export class UserSentimentEvent extends Event {
  constructor(
    readonly sessionId: string,
    readonly kind: SentimentKind,
  ) {
    super(USER_SENTIMENT_EVENT);
  }
}

/** Calls ``onSentiment`` each time the chat ``sessionId`` thanks, praises or insults igni. */
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
