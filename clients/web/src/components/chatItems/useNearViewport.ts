/**
 * Whether an element has come near the viewport, so a message's
 * miniatures are read only when they are about to be seen.
 *
 * The observation stops at the first intersection: a miniature that has
 * been seen stays read, and the observer is not kept alive for the
 * rest of the transcript's life.
 */

import { useEffect, useRef, useState, type RefObject } from "react";

/** How far outside the viewport an element counts as near. */
const MARGIN = "200px";

export function useNearViewport<T extends Element>(): {
  ref: RefObject<T | null>;
  near: boolean;
} {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Without an observer (a test, an old browser) the element is
    // taken to be near, so nothing waits for an observer that will
    // never call back.
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, near };
}
