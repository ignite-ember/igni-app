/**
 * One fenced code block as ReactMarkdown hands it to ``components.pre``:
 * a single ``<code class="language-…">{source}</code>`` child.
 */

import { isValidElement, type ReactNode } from "react";

/**
 * How a fence renders:
 * - ``mermaid``: a diagram.
 * - ``preformatted``: no language. The agent writes bare fences for
 *   calculations, flow charts and ASCII art, where line breaks and
 *   spacing carry the meaning.
 * - ``markdown``: only ``md`` / ``markdown`` / ``text`` / ``plain``, which
 *   the agent uses for prose that should render with formatting.
 * - ``code``: anything else.
 */
export type FenceKind = "mermaid" | "preformatted" | "markdown" | "code";

const MERMAID_LANGUAGE = "language-mermaid";

const UNFOLD_LANGUAGES: ReadonlySet<string> = new Set([
  "language-md",
  "language-markdown",
  "language-text",
  "language-plain",
]);

interface CodeElementProps {
  className?: string;
  children?: ReactNode;
}

export class FencedBlock {
  private constructor(
    /** The ``language-*`` classes on the ``<code>`` element. */
    readonly languages: readonly string[],
    /** The fence's text, without the trailing newline remark leaves. */
    readonly source: string,
  ) {}

  /** The fence inside a ``<pre>``, or null when its child is not an
   *  element (a stray text node, nothing at all). */
  static fromChildren(children: ReactNode): FencedBlock | null {
    if (!isValidElement<CodeElementProps>(children)) return null;
    const { className = "", children: text } = children.props;
    const languages = className.split(/\s+/).filter((token) => token.startsWith("language-"));
    return new FencedBlock(languages, String(text ?? "").replace(/\n$/, ""));
  }

  get kind(): FenceKind {
    if (this.languages.includes(MERMAID_LANGUAGE)) return "mermaid";
    if (this.languages.length === 0) return "preformatted";
    if (this.languages.every((language) => UNFOLD_LANGUAGES.has(language))) return "markdown";
    return "code";
  }

  /** Box-drawing and flow-chart glyphs only line up in a monospace font. */
  get needsMonospace(): boolean {
    return hasBoxDrawingChars(this.source) || hasFlowChartArrows(this.source);
  }
}

/** Any glyph from the Box Drawing block (U+2500 to U+257F): the
 *  ``┌─┐│└┘`` of the agent's ASCII diagrams. */
export function hasBoxDrawingChars(s: string): boolean {
  return /[─-╿]/.test(s);
}

/** The arrows the agent puts between pipeline stages. */
export function hasFlowChartArrows(s: string): boolean {
  return /[←→↑↓⇄⇅]/.test(s);
}
