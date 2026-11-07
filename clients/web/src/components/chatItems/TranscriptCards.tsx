/** The small transcript cards: compaction, loop passes, thinking, shell. */

import { memo, useState } from "react";

import type { CompactItem, LoopItem, ShellItem } from "../../chat/chatItem";
import { ChevronIcon } from "../Icons";
import { PlainMarkdown } from "../markdown/PlainMarkdown";

export const CompactCard = memo(function CompactCard({ item }: { item: CompactItem }) {
  const hasSummary = !!item.summary.trim();
  return (
    <div className="compact-card">
      <div className="compact-card-head">
        <span className="compact-card-badge" aria-hidden="true">∑</span>
        <span className="compact-card-title">Context compacted</span>
        <span className="compact-card-status">{item.status}</span>
      </div>
      {hasSummary && (
        <div className="compact-card-body">
          <PlainMarkdown text={item.summary} />
        </div>
      )}
    </div>
  );
});

/**
 * One ``/loop`` pass. No iteration number: the loop's pass count and the
 * agent's own task counter diverge for good reasons, and showing one
 * invites comparing them. The agent's text owns that narrative.
 */
export const LoopIterationCard = memo(function LoopIterationCard({ item }: { item: LoopItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="loop-iteration">
      <div className="loop-iteration-head">
        <span className="loop-iteration-badge" aria-label="Loop iteration">
          <span className="loop-iteration-arrow" aria-hidden="true">↻</span>
          <span>Loop</span>
        </span>
        <button
          type="button"
          className="loop-iteration-toggle"
          title={expanded ? "Hide the full wrapped prompt" : "Show what the model actually received"}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronIcon size={9} down={expanded} />
          {expanded ? "hide prompt" : "show prompt"}
        </button>
      </div>
      <div className="loop-iteration-body">
        <span className="loop-iteration-slash">/loop</span> {item.body}
      </div>
      {expanded && <pre className="loop-iteration-raw">{item.raw}</pre>}
    </div>
  );
});

export const ThinkingBlock = memo(function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="thinking-toggle" onClick={() => setOpen(!open)}>
        <ChevronIcon size={9} down={open} /> thinking…
      </div>
      {open && <div className="msg-thinking">{text}</div>}
    </div>
  );
});

export const ShellBlock = memo(function ShellBlock({ item }: { item: ShellItem }) {
  return (
    <div className="shell-output">
      <div className="prompt-line">$ {item.command}</div>
      {item.output ? item.output : item.exitCode === null ? "(running…)" : ""}
      {item.exitCode !== null && item.exitCode !== 0 && (
        <div className="shell-exit-code">(exit {item.exitCode})</div>
      )}
    </div>
  );
});
