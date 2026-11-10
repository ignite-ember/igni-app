/**
 * The window's item list and its history map, and the one
 * {@link TranscriptView} every controller writes them through.
 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { ChatItem } from "./chatItem";
import type { ChatItemFactory } from "./chatItemFactory";
import type { RunPhase } from "./runPhase";
import { TranscriptView } from "./transcriptView";

export interface TranscriptState {
  items: ChatItem[];
  historyIndexToItemIndex: number[];
  view: TranscriptView;
  /** The raw setter, for the push router, which predates the view. */
  setItems: Dispatch<SetStateAction<ChatItem[]>>;
}

export function useTranscriptState(chatItems: ChatItemFactory): TranscriptState {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [historyIndexToItemIndex, setHistoryMap] = useState<number[]>([]);
  // Read by controllers between renders (submit's continue-from-partial,
  // a plan card's run id), which hold no copy of their own.
  const itemsRef = useRef<ChatItem[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const view = useMemo(
    () => new TranscriptView(setItems, setHistoryMap, itemsRef, chatItems),
    [chatItems],
  );
  return { items, historyIndexToItemIndex, view, setItems };
}

/**
 * A cancelled run's reply is stamped interrupted, so its Retry /
 * Discard / Edit banner shows — whichever control cancelled it. On the
 * transition only: a phase that is already ``cancelled`` (a remount, a
 * mirrored view) is not stamped again.
 */
export function useStampCancelledReply(runPhase: RunPhase, view: TranscriptView): void {
  const prevPhaseRef = useRef(runPhase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = runPhase;
    if (runPhase === "cancelled" && prev !== "cancelled") {
      view.update((t) => t.markInterrupted("cancelled"));
    }
  }, [runPhase, view]);
}
