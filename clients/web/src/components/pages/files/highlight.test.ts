/**
 * Tests for splitting highlighted HTML into gutter lines.
 *
 * The one case that is easy to get wrong, and the whole reason this
 * code exists, is a highlighted span that straddles a newline: a naive
 * ``html.split("\n")`` leaves the first line with an unclosed
 * ``<span>`` and the next with an orphan ``</span>``. Every line must be
 * balanced on its own.
 */

import { describe, expect, it } from "vitest";

import hljs from "highlight.js/lib/common";
import { highlightToLines, resolveLanguage, splitHighlightedLines } from "./highlight";

describe("splitHighlightedLines", () => {
  it("keeps a span that crosses a newline closed and reopened per line", () => {
    const html = '<span class="hljs-comment">line one\nline two</span> after';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="hljs-comment">line one</span>',
      '<span class="hljs-comment">line two</span> after',
    ]);
  });

  it("handles nested spans across a break", () => {
    const html = '<span class="a">x<span class="b">y\nz</span>w</span>';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="a">x<span class="b">y</span></span>',
      '<span class="a"><span class="b">z</span>w</span>',
    ]);
  });

  it("drops the phantom trailing line from a final newline", () => {
    expect(splitHighlightedLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("keeps an intentional blank interior line", () => {
    expect(splitHighlightedLines("a\n\nb")).toEqual(["a", "", "b"]);
  });

  it("returns one line for one line", () => {
    expect(splitHighlightedLines("just text")).toEqual(["just text"]);
  });
});

describe("resolveLanguage", () => {
  it("resolves common kinds to ids highlight.js accepts", () => {
    expect(hljs.getLanguage(resolveLanguage("a/b.ts", "ts"))).toBeTruthy();
    expect(hljs.getLanguage(resolveLanguage("a/b.py"))).toBeTruthy();
  });

  it("maps an extension highlight.js does not know onto one it does", () => {
    // ``htm`` is not a highlight.js alias; the alias table sends it to xml.
    expect(resolveLanguage("a/page.htm")).toBe("xml");
  });

  it("falls back to auto-detect for an unknown kind", () => {
    expect(resolveLanguage("a/README", "")).toBe("");
    expect(resolveLanguage("a/data.unknownext")).toBe("");
  });
});

describe("highlightToLines", () => {
  it("produces one fragment per source line", () => {
    const lines = highlightToLines("x = 1\ny = 2\n", "python");
    expect(lines).toHaveLength(2);
  });

  it("escapes angle brackets rather than emitting raw HTML", () => {
    const lines = highlightToLines("a < b && c > d", "plaintext");
    expect(lines[0]).toContain("&lt;");
    expect(lines[0]).toContain("&gt;");
    expect(lines[0]).not.toContain("< b");
  });
});
