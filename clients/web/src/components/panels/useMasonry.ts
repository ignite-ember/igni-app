/** A masonry flow for a card grid: cards keep their own height and pack
 *  into whichever column frees up first, with the same gap everywhere.
 *
 *  The grid has 1px rows (`.plugins-grid--flow`); each card spans its
 *  measured height plus the gap. Auto-placement then puts every card in
 *  the first row where a column is free — the shortest column — while
 *  keeping the cards' left-to-right order, so a sort still reads as
 *  sorted. A card is `align-self: start`, so its height never depends on
 *  its span and measuring it cannot feed back into the layout.
 *
 *  Returned as a callback ref, because these grids appear only once their
 *  data has loaded: it wires up when the element mounts and tears down
 *  when it goes. Heights are re-measured whenever a card resizes (it
 *  opened, the window narrowed and text rewrapped) or the set of cards
 *  changes. Without a ResizeObserver (tests, very old engines) the grid
 *  stays a plain grid. */

import { useCallback, useRef } from "react";

export function useMasonry(): (grid: HTMLElement | null) => void {
  const teardown = useRef<(() => void) | null>(null);

  return useCallback((grid: HTMLElement | null) => {
    teardown.current?.();
    teardown.current = null;
    if (!grid || typeof ResizeObserver === "undefined") return;

    const layout = () => {
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      for (const card of Array.from(grid.children) as HTMLElement[]) {
        const height = card.getBoundingClientRect().height;
        card.style.gridRowEnd = `span ${Math.max(1, Math.ceil(height + gap))}`;
      }
    };

    const resize = new ResizeObserver(layout);
    const watch = () => {
      resize.disconnect();
      for (const card of Array.from(grid.children)) resize.observe(card);
    };
    const children = new MutationObserver(() => {
      watch();
      layout();
    });

    children.observe(grid, { childList: true });
    watch();
    layout();
    teardown.current = () => {
      resize.disconnect();
      children.disconnect();
    };
  }, []);
}
