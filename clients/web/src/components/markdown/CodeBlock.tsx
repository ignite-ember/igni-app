/** The three ways a fenced block renders besides a diagram. */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { CopyButton } from "../CopyButton";
import { ChevronIcon } from "../Icons";
import type { FencedBlock } from "./fencedBlock";
import { MarkdownRepair } from "./markdownRepair";
import { PlainMarkdown } from "./PlainMarkdown";

/** Above this rendered height a code block starts collapsed, about ten
 *  lines. ``theme.css`` clips ``.code-block-wrap--collapsed pre`` at the
 *  same height; the two must agree. */
const COLLAPSED_MAX_PX = 220;
/** Slack for sub-pixel rounding, so a block that fits is not collapsed. */
const OVERFLOW_TOLERANCE_PX = 4;

/** A code fence: copy button, and a collapse toggle when it is tall.
 *  The copy reads the rendered text, highlighting whitespace included. */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [overflowing, setOverflowing] = useState(false);
  // Measured after render: a block that fits drops its collapsed state,
  // so nothing changes visually.
  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    const overflows = el.scrollHeight > COLLAPSED_MAX_PX + OVERFLOW_TOLERANCE_PX;
    setOverflowing(overflows);
    if (!overflows) setCollapsed(false);
  }, [children]);
  const isCollapsed = overflowing && collapsed;
  return (
    <div className={`code-block-wrap${isCollapsed ? " code-block-wrap--collapsed" : ""}`}>
      <CopyButton
        className="code-block-copy"
        idleLabel="Copy code"
        text={() => preRef.current?.textContent ?? ""}
      />
      <pre ref={preRef} onClick={isCollapsed ? () => setCollapsed(false) : undefined}>
        {children}
      </pre>
      {overflowing ? (
        <button
          type="button"
          className="code-block-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand code" : "Collapse code"}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          <ChevronIcon size={12} down={!isCollapsed} />
        </button>
      ) : null}
    </div>
  );
}

/** A bare fence: line breaks and runs of spaces kept, in monospace only
 *  when the glyphs need columns to line up. */
export function PreformattedBlock({ block }: { block: FencedBlock }) {
  return (
    <pre className={`markdown-block-pre${block.needsMonospace ? " markdown-block-pre--mono" : ""}`}>
      <code>{block.source}</code>
    </pre>
  );
}

/** A ``md`` / ``text`` fence, rendered as the markdown it is. */
export function MarkdownBlock({ source }: { source: string }) {
  return (
    <div className="markdown-block-wrap">
      <PlainMarkdown text={MarkdownRepair.standard.apply(source)} />
    </div>
  );
}
