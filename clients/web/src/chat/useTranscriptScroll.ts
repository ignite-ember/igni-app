/**
 * Where the transcript is scrolled: ``ui.scroll`` — whether it follows
 * the newest message, and the message at the top once it comes to rest.
 *
 * Virtuoso owns the scrolling. This tells the model at a transition or
 * a settle, never per pixel; lands a restored session at its latest
 * message; and goes where an extension's ``scroll_to`` says.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

import { useWindowField, type Scroll, type WindowModel } from "../clientState";
import type { ChatItem } from "./chatItem";
import { useChatFollow, type ChatFollow } from "./followOutput";
import { indexOfRun, runAt } from "./runIndex";

/**
 * The chat list's ``atBottomThreshold``. Virtuoso's 4px default misses
 * the "at bottom" transition by a sub-pixel after every layout change
 * (the composer growing on Send, the last row rewritten by streaming),
 * and following stops. 50px rides those out without hiding a real
 * scroll up — pinned by ``e2e/chat-scroll.spec.ts``.
 */
export const AT_BOTTOM_THRESHOLD = 50;

export interface TranscriptScroll {
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  /** The first item in view, as Virtuoso last reported it. */
  topIndexRef: { current: number };
  /** The scroller element, for the scroll indicator to measure. */
  scrollEl: HTMLElement | null;
  setScrollEl: (el: HTMLElement | null) => void;
  /** Tell the model where the view is. */
  tellScroll: (atBottom: boolean) => void;
  follow: ChatFollow;
  scrollToBottom: () => void;
  stickToBottom: boolean;
}

export function useTranscriptScroll(windowModel: WindowModel, items: ChatItem[]): TranscriptScroll {
  const scroll = useWindowField(windowModel, "scroll");
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const topIndexRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const tellScroll = useCallback(
    (atBottom: boolean) =>
      windowModel.write("scroll", {
        message_id: atBottom ? null : runAt(itemsRef.current, topIndexRef.current),
        at_bottom: atBottom,
      }),
    [windowModel],
  );
  // Virtuoso's "at bottom", once it agrees with the page (V6).
  const follow = useChatFollow(items.length, AT_BOTTOM_THRESHOLD, tellScroll);
  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "auto" });
    tellScroll(true);
  }, [tellScroll]);

  // A restored session lands at its latest message, once: the first
  // time the list fills, after Virtuoso has the new data — scrolling
  // from the boot sequence itself would run against the empty list.
  const bootScrollDoneRef = useRef(false);
  useEffect(() => {
    if (bootScrollDoneRef.current || items.length === 0) return;
    bootScrollDoneRef.current = true;
    scrollToBottom();
  }, [items.length, scrollToBottom]);

  // An extension's ``scroll_to``: the model says where, this window goes.
  useEffect(
    () =>
      windowModel.onRemote((change) => {
        if (change.field !== "scroll") return;
        const where = change.value as Scroll;
        if (where.at_bottom) {
          virtuosoRef.current?.scrollToIndex({ index: "LAST", behavior: "auto" });
          return;
        }
        const index = where.message_id ? indexOfRun(itemsRef.current, where.message_id) : -1;
        if (index >= 0) {
          virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "auto" });
        }
      }),
    [windowModel],
  );

  return {
    virtuosoRef,
    topIndexRef,
    scrollEl,
    setScrollEl,
    tellScroll,
    follow,
    scrollToBottom,
    stickToBottom: scroll.at_bottom,
  };
}
