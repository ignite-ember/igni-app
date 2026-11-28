import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ScrollIndicator } from "../ScrollIndicator";
import { TopBlur } from "./TopBlur";

/**
 * The one way a page scrolls.
 *
 * The owner's rule: every page fades the same way, and a page's header
 * row — its title, tabs, search, filter, sort and action buttons — does
 * not scroll. So the scrolling element, its fade, the blur over the
 * fixed chrome above it, its rest state and its offset all live here,
 * and pages do not choose any of it. `PageShell` decides the mode from
 * whether it has a header row:
 *
 * - **chrome** (`chrome` given): the rows stay put and only the content
 *   scrolls. It slides *under* them and dissolves on the chat's curve
 *   (`--top-fade-mask`) behind the chat's blur, both moved down by the
 *   rows' measured height. The rows draw over it, crisp.
 * - **app** (no `chrome`): a detail or document view, whose title is in
 *   the body. The content goes up under the app header and dissolves at
 *   the window's top exactly like the chat.
 *
 * In both, the scroller reaches up to the top of the window (as
 * `.conversation` does) and is padded back down, so at rest the content
 * sits where it always did. At rest nothing is faded or blurred: the mask
 * turns on at the first scrolled pixel, and over the first
 * {@link FADE_REST_SHIFT} pixels the fade and blur slide down into place,
 * so nothing jumps either.
 */

/** How far the fade and blur sit above their place at rest, in px. */
export const FADE_REST_SHIFT = 24;

/** Which fixed chrome the content scrolls under. */
export type FadeMode = "chrome" | "app";

/** Write the chrome's height on the root as ``--fade-chrome-h``. */
function useChromeHeight(root: RefObject<HTMLDivElement | null>, chrome: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = chrome.current;
    const host = root.current;
    if (!host) return;
    if (!el) {
      host.style.setProperty("--fade-chrome-h", "0px");
      return;
    }
    const write = () => host.style.setProperty("--fade-chrome-h", `${el.offsetHeight}px`);
    write();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => observer.disconnect();
  });
}

/**
 * Track the scroller's offset into ``--fade-rest-shift`` and
 * ``data-scrolled`` on the root. Content that scrolls itself is always
 * "scrolled": its offset cannot be seen from here.
 */
function useRestShift(
  root: RefObject<HTMLDivElement | null>,
  scroller: RefObject<HTMLDivElement | null>,
  selfScrolling: boolean,
) {
  useLayoutEffect(() => {
    const host = root.current;
    const el = scroller.current;
    if (!host || !el) return;
    let last = -1;
    const update = () => {
      const shift = selfScrolling ? 0 : Math.max(0, FADE_REST_SHIFT - Math.max(0, el.scrollTop));
      if (shift === last) return;
      last = shift;
      host.style.setProperty("--fade-rest-shift", `${shift}px`);
      host.toggleAttribute("data-scrolled", shift < FADE_REST_SHIFT);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [root, scroller, selfScrolling]);
}

export function FadeScroll({
  chrome,
  className,
  selfScrolling = false,
  children,
}: {
  /** The fixed rows above the content. Given: the content scrolls under
   *  them. Absent: under the app header. */
  chrome?: ReactNode;
  /** Extra class on the scroller. */
  className?: string;
  /** The content is a frame that scrolls itself: the scroller stays
   *  still, the frame reaches under the chrome, and the fade and blur
   *  stay on. The frame is told the inset to leave
   *  (``--fade-inset-top``). */
  selfScrolling?: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const chromeEl = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const mode: FadeMode = chrome ? "chrome" : "app";
  useChromeHeight(root, chromeEl);
  useRestShift(root, scroller, selfScrolling);

  return (
    <div
      ref={root}
      className="fade-scroll"
      data-fade={mode}
      data-self-scrolling={selfScrolling || undefined}
    >
      {chrome ? (
        <div ref={chromeEl} className="fade-scroll-chrome">
          {chrome}
        </div>
      ) : null}
      <div className="fade-scroll-blur" aria-hidden="true">
        <TopBlur />
      </div>
      <div
        ref={(el) => {
          scroller.current = el;
          setScrollEl(el);
        }}
        className={className ? `fade-scroll-body ${className}` : "fade-scroll-body"}
      >
        {children}
      </div>
      {/* The native scrollbar sits inside the faded scroller, so it faded
          with the content and reappeared above it. The chat's own thumb is
          drawn instead, over the fade, on a track that starts below the
          fixed chrome. A frame draws its own. */}
      {selfScrolling ? null : <ScrollIndicator element={scrollEl} belowPadding />}
    </div>
  );
}
