/**
 * Find in the conversation: the ``search`` panel of ``ui.panel``,
 * Cmd/Ctrl+F to open it, and the pulse that lands the eye on a result.
 *
 * The picked-out message is ``ui.selection.message_id`` — a result
 * jumped to, or an extension's ``select``. When it changes the row
 * pulses; the pulse has a timer, so it is this view's own state.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

import { useWindowField, type Panel, type WindowModel } from "../clientState";
import type { ChatItem } from "./chatItem";
import { indexOfRun, runAt } from "./runIndex";

/** How long a picked-out row pulses. */
export const PULSE_MS = 2400;

export interface ChatSearch {
  searchOpen: boolean;
  toggleSearch: () => void;
  /** The row pulsing now, by item id. */
  pulsingItemId: number | null;
  /** A result picked in the search bar, by item index. */
  onSearchJump: (itemIndex: number) => void;
}

export function useChatSearch(
  windowModel: WindowModel,
  items: ChatItem[],
  virtuosoRef: RefObject<VirtuosoHandle | null>,
  panel: Panel | null,
): ChatSearch {
  const searchOpen = panel?.kind === "search";
  const toggleSearch = useCallback(() => windowModel.togglePanel("search"), [windowModel]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return;
      // Only when there is something to search.
      if (items.length === 0) return;
      e.preventDefault();
      toggleSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, toggleSearch]);

  const selection = useWindowField(windowModel, "selection");
  const [pulsingItemId, setPulsingItemId] = useState<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const pulse = useCallback((itemId: number) => {
    setPulsingItemId(itemId);
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulsingItemId(null), PULSE_MS);
  }, []);
  // Set when this window pulsed the row itself: a search jump lands on
  // the hit, which may be the answer rather than the question.
  const pulsedRunRef = useRef<string | null>(null);
  useEffect(() => {
    const run = selection.message_id;
    if (!run) return;
    if (pulsedRunRef.current === run) {
      pulsedRunRef.current = null;
      return;
    }
    const index = indexOfRun(itemsRef.current, run);
    if (index >= 0) pulse(itemsRef.current[index].id);
  }, [selection.message_id, pulse]);
  useEffect(
    () => () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
    },
    [],
  );

  const onSearchJump = useCallback(
    (itemIndex: number) => {
      virtuosoRef.current?.scrollToIndex({ index: itemIndex, align: "center", behavior: "auto" });
      const target = items[itemIndex];
      if (!target) return;
      const run = runAt(items, itemIndex);
      // A result in a run is the message picked out; one before any run
      // (an info line) can only pulse.
      if (run && windowModel.get("selection").message_id !== run) {
        pulsedRunRef.current = run;
        windowModel.write("selection", { ...windowModel.get("selection"), message_id: run });
      }
      pulse(target.id);
    },
    [items, pulse, windowModel, virtuosoRef],
  );

  return { searchOpen, toggleSearch, pulsingItemId, onSearchJump };
}
