/**
 * The window event the push-channel router dispatches when Laya reads a
 * person's message as thanks or praise for igni, and the hook a view
 * subscribes to it with.
 */

import { useEffect, useRef } from "react";

import type { AppreciationKind } from "../protocol/pushChannels";

export const USER_APPRECIATION_EVENT = "ember:user_appreciation";

/** The person's message in ``sessionId`` thanked or praised igni. */
export class UserAppreciationEvent extends Event {
  constructor(
    readonly sessionId: string,
    readonly kind: AppreciationKind,
  ) {
    super(USER_APPRECIATION_EVENT);
  }
}

/** Calls ``onAppreciated`` each time the chat ``sessionId`` thanks or praises igni. */
export function useUserAppreciation(
  sessionId: string,
  onAppreciated: (ev: UserAppreciationEvent) => void,
  target: EventTarget = window,
): void {
  const latest = useRef(onAppreciated);
  latest.current = onAppreciated;

  useEffect(() => {
    const listener = (e: Event) => {
      if (e instanceof UserAppreciationEvent && e.sessionId === sessionId) latest.current(e);
    };
    target.addEventListener(USER_APPRECIATION_EVENT, listener);
    return () => target.removeEventListener(USER_APPRECIATION_EVENT, listener);
  }, [sessionId, target]);
}
