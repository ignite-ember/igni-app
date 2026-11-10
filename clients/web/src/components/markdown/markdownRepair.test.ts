import { describe, expect, it } from "vitest";
import { MarkdownRepair } from "./markdownRepair";

const repair = (text: string) => MarkdownRepair.standard.apply(text);

describe("MarkdownRepair.standard", () => {
  it("inserts blank line before a heading glued to prior text", () => {
    const before = "some intro text\n## Origins";
    const out = repair(before);
    expect(out).toBe("some intro text\n\n## Origins");
  });

  it("inserts blank line after a heading immediately followed by prose", () => {
    const before = "## Heading\nBody starts here.";
    const out = repair(before);
    expect(out).toBe("## Heading\n\nBody starts here.");
  });

  it("splits a heading that has the following paragraph stuck to it without whitespace", () => {
    // The Gandalf bug: model emitted the heading and the first
    // paragraph as one line, no separator at all.
    const before =
      "## Origins Beyond the MountainsBefore ever he walked among the peoples of Middle-earth, the spirit existed.";
    const out = repair(before);
    expect(out).toBe(
      "## Origins Beyond the Mountains\n\nBefore ever he walked among the peoples of Middle-earth, the spirit existed.",
    );
  });

  it("does NOT split camelCase brand names in short headings", () => {
    // Real cases: programming brands often appear in headings.
    // They don't have a trailing "space + more words" after the
    // capital letter, so the heuristic leaves them alone.
    expect(repair("## iPhone")).toBe("## iPhone");
    expect(repair("## JavaScript")).toBe("## JavaScript");
    expect(repair("# ChatGPT")).toBe("# ChatGPT");
  });

  it("does NOT split a heading that ends cleanly with a newline", () => {
    const before = "## Origins Beyond the Mountains\n\nBefore ever he walked.";
    const out = repair(before);
    expect(out).toBe(before);
  });

  it("leaves regular paragraph text alone", () => {
    const text = "Hello! How can I help you today?";
    expect(repair(text)).toBe(text);
  });

  it("splits a heading with an opening code fence glued to its end", () => {
    const before = "### Recommended Fix Order```\n1 do thing\n```";
    const out = repair(before);
    expect(out).toBe(
      "### Recommended Fix Order\n\n```\n1 do thing\n```",
    );
  });

  it("splits a heading with a fence + language info string", () => {
    const before = "## Example ```python\nprint(1)\n```";
    const out = repair(before);
    expect(out).toBe("## Example\n\n```python\nprint(1)\n```");
  });

  it("does NOT split a heading that contains inline single-backtick code", () => {
    const before = "### Use `foo` correctly";
    expect(repair(before)).toBe(before);
  });

  it("retains existing GFM-table normalization", () => {
    // One-line table → re-broken into rows.
    const before = "| a | b | |---|---| | 1 | 2 |";
    const out = repair(before);
    expect(out).toContain("|---|---|\n");
  });

  it("splits a horizontal rule glued to a heading on the same line", () => {
    // Common case: the model emits `---` as a section divider and
    // forgets to put it on its own line, so it gets concatenated to
    // the next heading. Without the fix the whole line renders as
    // literal text "---## …".
    const before = "---## The Training Recipe: SSP";
    expect(repair(before)).toBe(
      "---\n\n## The Training Recipe: SSP",
    );
  });

  it("splits a horizontal rule glued to plain paragraph text", () => {
    // Less common but the same fix: `---` followed by text on the
    // same line should still render the HR.
    const before = "intro paragraph\n---Then this happened.";
    expect(repair(before)).toBe(
      "intro paragraph\n\n---\n\nThen this happened.",
    );
  });

  it("leaves a bare horizontal rule alone", () => {
    expect(repair("---")).toBe("---");
  });

  it("leaves a horizontal rule with trailing whitespace alone", () => {
    // Both already parse as <hr> in CommonMark — don't touch.
    expect(repair("--- ")).toBe("--- ");
    expect(repair("---   ")).toBe("---   ");
  });

  it("leaves a 4+ dash line alone (still a valid HR)", () => {
    expect(repair("----")).toBe("----");
    expect(repair("-----")).toBe("-----");
  });

  it("splits multiple glued HRs in one message", () => {
    const before = "---## First\n\nbody\n---## Second";
    expect(repair(before)).toBe(
      "---\n\n## First\n\nbody\n\n---\n\n## Second",
    );
  });
});

describe("MarkdownRepair rules", () => {
  it("runs the heading rules first, the rule rules next, the table rule last", () => {
    expect(MarkdownRepair.standard.rules.map((r) => r.name)).toEqual([
      "headingGapBefore",
      "headingGapAfter",
      "stuckWordHeading",
      "headingGluedToTable",
      "headingGluedToFence",
      "hrGapBefore",
      "hrGluedToText",
      "singleLineTable",
    ]);
  });

  it("splits a heading glued to a table header", () => {
    expect(repair("### What's Solid | Area | Detail |")).toBe(
      "### What's Solid\n\n | Area | Detail |",
    );
  });

  it("leaves empty text alone", () => {
    expect(repair("")).toBe("");
  });
});
