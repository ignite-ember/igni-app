import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FencedBlock, hasBoxDrawingChars, hasFlowChartArrows } from "./fencedBlock";

// ReactMarkdown hands ``components.pre`` a single <code> element with
// the language class and the source as children. A real React element
// mimics that shape, so ``isValidElement`` matches.
const codeEl = (className: string, children: string) => createElement("code", { className }, children);
const fence = (className: string, children: string) => FencedBlock.fromChildren(codeEl(className, children));

describe("FencedBlock.kind", () => {
  it("is mermaid for a mermaid fence", () => {
    expect(fence("language-mermaid", "graph TD")?.kind).toBe("mermaid");
  });

  it("is preformatted for a bare fence, the agent's main case", () => {
    // The agent writes bare fences for calculations, flow charts and
    // ASCII art; they keep their whitespace rather than unfold as
    // markdown.
    expect(fence("", "100 × 200 = 20000")?.kind).toBe("preformatted");
  });

  it("is preformatted when the only class is not a language (hljs)", () => {
    expect(fence("hljs", "x")?.kind).toBe("preformatted");
  });

  it("is markdown for md, markdown, text and plain", () => {
    expect(fence("language-md", "# Heading")?.kind).toBe("markdown");
    expect(fence("language-markdown", "**bold**")?.kind).toBe("markdown");
    expect(fence("language-text", "plain prose")?.kind).toBe("markdown");
    expect(fence("language-plain", "raw text")?.kind).toBe("markdown");
  });

  it("matches a language class among other tokens", () => {
    // rehype-highlight may attach several class tokens.
    expect(fence("hljs language-md", "x")?.kind).toBe("markdown");
  });

  it("is code for a real language", () => {
    expect(fence("language-python", "print(1)")?.kind).toBe("code");
  });

  it("is code when an unfold language is mixed with a real one", () => {
    // Ambiguous: default to code. At worst the person sees a code
    // block; unfolding code as markdown could lose its syntax.
    expect(fence("language-md language-python", "print('# H')")?.kind).toBe("code");
  });
});

describe("FencedBlock.fromChildren", () => {
  it("lists the language classes", () => {
    expect(fence("hljs language-md", "x")?.languages).toEqual(["language-md"]);
    expect(fence("", "x")?.languages).toEqual([]);
  });

  it("strips a single trailing newline (the fence-node artifact)", () => {
    expect(fence("language-md", "# H\n")?.source).toBe("# H");
    expect(fence("", "a\n\n")?.source).toBe("a\n");
  });

  it("is null for children that are not an element", () => {
    // A stray text node, null and so on fall back to the code block.
    expect(FencedBlock.fromChildren("plain string")).toBeNull();
    expect(FencedBlock.fromChildren(null)).toBeNull();
    expect(FencedBlock.fromChildren(undefined)).toBeNull();
    expect(FencedBlock.fromChildren(42)).toBeNull();
  });
});

describe("FencedBlock.needsMonospace", () => {
  it("is true for box drawing or flow-chart arrows", () => {
    expect(fence("", "┌──┐")?.needsMonospace).toBe(true);
    expect(fence("", "a\n  ↓\nb")?.needsMonospace).toBe(true);
  });

  it("is false for plain text and math", () => {
    expect(fence("", "100 × 200 = 20000")?.needsMonospace).toBe(false);
  });
});

describe("hasBoxDrawingChars", () => {
  it("detects the box-drawing characters the agent uses", () => {
    expect(hasBoxDrawingChars("┌──┐")).toBe(true);
    expect(hasBoxDrawingChars("│ hi │")).toBe(true);
    expect(hasBoxDrawingChars("└──┘")).toBe(true);
    expect(hasBoxDrawingChars("─")).toBe(true);
    expect(hasBoxDrawingChars("│")).toBe(true);
  });

  it("returns true even when only one drawing char is present", () => {
    // The check is "any drawing glyph triggers the monospace
    // path" — the user wants column alignment preserved for
    // anything visually structured, not just diagrams that are
    // 100% drawing chars.
    expect(hasBoxDrawingChars("hello ┌─ world")).toBe(true);
  });

  it("returns false for plain prose without drawing glyphs", () => {
    expect(hasBoxDrawingChars("# Heading\n\nSome **bold** prose")).toBe(false);
    expect(hasBoxDrawingChars("100 × 200 = 20000")).toBe(false);
  });

  it("returns false for math arrows that aren't box-drawing", () => {
    // The math arrows ↑→↓←≈ are not in the Box Drawing block.
    // They render fine in a proportional font; routing them
    // through the monospace path would just look weird.
    expect(hasBoxDrawingChars("↑ → ↓ ←")).toBe(false);
    expect(hasBoxDrawingChars("≈ × ÷")).toBe(false);
  });

  it("returns false for empty / non-string-ish inputs", () => {
    expect(hasBoxDrawingChars("")).toBe(false);
  });
});

describe("hasFlowChartArrows", () => {
  it("detects the arrow chars the agent uses", () => {
    expect(hasFlowChartArrows("↓")).toBe(true);
    expect(hasFlowChartArrows("↑ ↓ → ←")).toBe(true);
    expect(hasFlowChartArrows("⇄")).toBe(true);
  });

  it("returns true even when only one arrow is present", () => {
    expect(hasFlowChartArrows("User hits send\n    ↓\nBackend responds")).toBe(true);
  });

  it("returns false for plain text without arrows", () => {
    expect(hasFlowChartArrows("100 × 200 = 20000")).toBe(false);
  });
});
