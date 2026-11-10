import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";

import type { ChatItem } from "../chat/chatItem";
import type { ChatTranscript } from "../chat/chatTranscript";
import { isProcessing, phaseLabel, shouldShowSpinner, type RunPhase } from "../chat/runPhase";
import { AT_BOTTOM_THRESHOLD, type TranscriptScroll } from "../chat/useTranscriptScroll";
import { ChatItemView } from "./chatItems/ChatItemView";
import type { ChatItemHandlers } from "./chatItems/handlers";

/** Room above the first message, so its edit/delete chip clears the
 *  frosted header's drag region. */
const HEADER_SPACER_PX = 78;

/** How far past the viewport Virtuoso renders, each way. */
const OVERSCAN = { top: 400, bottom: 800 } as const;

/** The typing indicator under the last message while a run is live. */
function TypingFooter({ runPhase }: { runPhase: RunPhase }) {
  if (!shouldShowSpinner(runPhase)) return null;
  return (
    <div className="chat-row">
      <div className="typing-indicator" aria-live="polite">
        <span className="typing-dots">
          <span />
          <span />
          <span />
        </span>
        <span className="typing-label">{phaseLabel(runPhase)}</span>
        {isProcessing(runPhase) && <span className="typing-hint">Esc to cancel</span>}
      </div>
    </div>
  );
}

/**
 * The conversation as a virtualized list, and the button back to its
 * end when the person has scrolled away from it.
 *
 * Following the tail is Virtuoso's ``followOutput``, gated on its "at
 * bottom" agreeing with the page (``chat/followOutput``), and never
 * ``smooth`` so streaming does not visibly chase tokens.
 */
export function ConversationList({
  items,
  transcript,
  runPhase,
  processing,
  pulsingItemId,
  handlers,
  scroll,
  atBottomNow,
}: {
  items: ChatItem[];
  transcript: (items: ChatItem[]) => ChatTranscript;
  runPhase: RunPhase;
  processing: boolean;
  pulsingItemId: number | null;
  handlers: ChatItemHandlers;
  scroll: TranscriptScroll;
  /** ``ui.scroll.at_bottom`` as the model has it now. */
  atBottomNow: () => boolean;
}) {
  const view = useMemo(() => transcript(items), [transcript, items]);
  // Stable unless the footer would change, so a streamed token or a
  // status tick does not hand Virtuoso a new Footer to remount.
  const components = useMemo(
    () => ({
      Header: () => <div aria-hidden="true" style={{ height: HEADER_SPACER_PX }} />,
      Footer: () => <TypingFooter runPhase={runPhase} />,
    }),
    [runPhase],
  );
  const { follow } = scroll;

  return (
    <>
      <Virtuoso
        ref={scroll.virtuosoRef}
        className="conversation"
        data={items}
        // By id, so React reuses rows across edits and ChatItemView's memo holds.
        computeItemKey={(_idx, item) => item.id}
        followOutput={follow.followOutput}
        totalListHeightChanged={follow.totalListHeightChanged}
        atBottomThreshold={AT_BOTTOM_THRESHOLD}
        atBottomStateChange={follow.atBottomStateChange}
        rangeChanged={(range) => {
          scroll.topIndexRef.current = range.startIndex;
        }}
        // Come to rest: where the top of the view is, once per stop.
        isScrolling={(moving) => {
          if (!moving) scroll.tellScroll(atBottomNow());
        }}
        scrollerRef={(el) => {
          follow.scrollerRef(el);
          scroll.setScrollEl(el as HTMLElement | null);
        }}
        increaseViewportBy={OVERSCAN}
        itemContent={(idx, item) => {
          // The blinking caret, on the live tail's reply only.
          const isStreamingTail = processing && idx === items.length - 1 && item.kind === "assistant";
          const isSearchTarget = item.id === pulsingItemId;
          return (
            <div
              className={`chat-row${isStreamingTail ? " streaming" : ""}${isSearchTarget ? " search-target" : ""}`}
            >
              <ChatItemView
                item={item}
                copyResponseText={item.kind === "stats" ? view.assistantTextForStats(idx) : undefined}
                handlers={handlers}
              />
            </div>
          );
        }}
        components={components}
      />
      {!scroll.stickToBottom && (
        <button
          type="button"
          className="scroll-to-bottom"
          title="Scroll to latest"
          aria-label="Scroll to latest"
          onClick={scroll.scrollToBottom}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 3v9.5M3.8 8.3L8 12.5l4.2-4.2" />
          </svg>
        </button>
      )}
    </>
  );
}
