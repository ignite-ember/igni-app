/** Keeps the toast stack clear of the composer: writes the stack's
 *  bottom offset (``--toasts-bottom``) from where the composer is. */

import { useLayoutEffect, type RefObject } from "react";

import { ComposerClearance } from "../../notifications/composerClearance";

/** The stack's widest width and its gap to the edges, in px. */
export const TOAST_STACK_WIDTH = 360;
export const TOAST_GUTTER = 16;

const CLEARANCE = new ComposerClearance(TOAST_STACK_WIDTH, TOAST_GUTTER);

export function useComposerClearance(stack: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const el = stack.current;
    if (!active || !el) return;
    const composer = document.querySelector<HTMLElement>(".composer");
    const update = () => {
      const bottom = CLEARANCE.bottomFor(composer?.getBoundingClientRect() ?? null, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      el.style.setProperty("--toasts-bottom", `${bottom}px`);
    };
    update();
    window.addEventListener("resize", update);
    const resized = typeof ResizeObserver === "undefined" || !composer ? null : new ResizeObserver(update);
    resized?.observe(composer as HTMLElement);
    return () => {
      window.removeEventListener("resize", update);
      resized?.disconnect();
    };
  }, [stack, active]);
}
