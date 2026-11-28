/** A toast's life on screen: it hides itself after {@link TOAST_TTL_MS}
 *  unless a pointer or keyboard focus is on it, and plays its exit before
 *  it leaves the window model. */

import { useEffect, useRef, useState } from "react";

import { ToastTimer } from "../../notifications/toastTimer";

/** Auto-hide after this many ms on screen, pauses not counted. */
export const TOAST_TTL_MS = 8000;
/** The exit animation after the timer runs out. */
export const TOAST_EXPIRE_EXIT_MS = 200;
/** The exit animation after the person closes or opens it. */
export const TOAST_CLOSE_EXIT_MS = 150;

/** Handlers that hold the countdown while the toast is being looked at. */
export interface ToastHoldHandlers {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

export interface ToastLifecycle {
  closing: boolean;
  /** Play the exit, then leave. */
  close: () => void;
  hold: ToastHoldHandlers;
}

export function useToastLifecycle(id: string, onDismiss: () => void): ToastLifecycle {
  const [closing, setClosing] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const timer = useRef<ToastTimer | null>(null);
  const leaving = useRef(false);
  const hovered = useRef(false);
  const focused = useRef(false);

  const leave = (afterMs: number) => {
    if (leaving.current) return;
    leaving.current = true;
    timer.current?.cancel();
    setClosing(true);
    window.setTimeout(() => dismiss.current(), afterMs);
  };

  useEffect(() => {
    leaving.current = false;
    const countdown = new ToastTimer(TOAST_TTL_MS, () => leave(TOAST_EXPIRE_EXIT_MS));
    timer.current = countdown;
    if (hovered.current) countdown.pause();
    if (focused.current) countdown.pause();
    countdown.start();
    return () => countdown.cancel();
    // A toast's countdown is its own; a new handler does not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const holdWhile = (flag: { current: boolean }, on: boolean) => {
    if (flag.current === on) return;
    flag.current = on;
    if (on) timer.current?.pause();
    else timer.current?.resume();
  };

  return {
    closing,
    close: () => leave(TOAST_CLOSE_EXIT_MS),
    hold: {
      onMouseEnter: () => holdWhile(hovered, true),
      onMouseLeave: () => holdWhile(hovered, false),
      onFocus: () => holdWhile(focused, true),
      onBlur: () => holdWhile(focused, false),
    },
  };
}
