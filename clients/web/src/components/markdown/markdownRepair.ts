/**
 * Repairs for the markdown models write, applied before an assistant
 * reply is rendered.
 *
 * Each rule is one shape seen in real replies that CommonMark or GFM
 * would otherwise render wrong. The rules run in order: the heading
 * rules first, the horizontal-rule rules before the table rule.
 */

export interface MarkdownRepairRule {
  readonly name: string;
  apply(text: string): string;
}

/** A rule that is one regex replacement. */
class ReplaceRule implements MarkdownRepairRule {
  constructor(
    readonly name: string,
    private readonly pattern: RegExp,
    private readonly replacement: string,
  ) {}

  apply(text: string): string {
    return text.replace(this.pattern, this.replacement);
  }
}

/**
 * A whole GFM table emitted on one line (``| a | b | |---|---| | 1 | 2 |``):
 * each ``|…|`` group goes back on its own line so remark-gfm can parse it.
 */
class SingleLineTableRule implements MarkdownRepairRule {
  readonly name = "singleLineTable";
  private static readonly SEPARATOR = /\|\s*-{2,}/;
  private static readonly CELL_GAP = /(?<=\|)\s+(?=\|)/g;

  apply(text: string): string {
    if (!text.includes("|") || !SingleLineTableRule.SEPARATOR.test(text)) return text;
    return text
      .split("\n")
      .map((line) => this.splitRow(line))
      .join("\n");
  }

  private splitRow(line: string): string {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !SingleLineTableRule.SEPARATOR.test(trimmed)) return line;
    const cells = trimmed.split(SingleLineTableRule.CELL_GAP);
    if (cells.length < 2) return line;
    return cells.join("\n");
  }
}

export class MarkdownRepair {
  /** The repairs every assistant reply gets, in the order they run. */
  static readonly standard = new MarkdownRepair([
    // A heading glued to the line before it renders as part of that
    // paragraph.
    new ReplaceRule("headingGapBefore", /([^\n])\n(#{1,6} )/g, "$1\n\n$2"),
    // A heading glued to the line after it swallows that line visually.
    new ReplaceRule("headingGapAfter", /(^|\n)(#{1,6} [^\n]*)\n([^\n#])/g, "$1$2\n\n$3"),
    // ``## Origins Beyond the MountainsBefore ever he walked…``: the
    // paragraph stuck to the heading with no whitespace. Four lowercase
    // letters, then a capitalised word followed by more words, so
    // ``JavaScript`` or ``iPhone`` are left alone.
    new ReplaceRule(
      "stuckWordHeading",
      /^(#{1,6}\s\S.+?[a-z]{4})([A-Z][a-z]+\s.+)$/gm,
      "$1\n\n$2",
    ),
    // ``### What's Solid| Area | Detail |``: the table header on the
    // heading's line, which makes the whole table heading text.
    new ReplaceRule("headingGluedToTable", /^(#{1,6}\s[^\n|]+?\S)(\s\|\s.+)$/gm, "$1\n\n$2"),
    // ``### Recommended Fix Order```: the opening fence on the
    // heading's line, which reads as inline code and turns the closing
    // fence into an opening one that swallows the rest of the reply.
    new ReplaceRule(
      "headingGluedToFence",
      /^(#{1,6}\s+\S[^\n`]*?)\s*(```[\w-]*)\s*$/gm,
      "$1\n\n$2",
    ),
    // A thematic break needs a blank line before it, or it joins the
    // paragraph above.
    new ReplaceRule("hrGapBefore", /([^\n])\n(---)/g, "$1\n\n$2"),
    // ``---## Heading`` / ``---Some text``: a break is only a break
    // alone on its line. ``----`` and ``--- `` already are.
    new ReplaceRule("hrGluedToText", /^(---)([^\s-].*)$/gm, "$1\n\n$2"),
    new SingleLineTableRule(),
  ]);

  constructor(readonly rules: readonly MarkdownRepairRule[]) {}

  apply(text: string): string {
    if (!text) return text;
    return this.rules.reduce((out, rule) => rule.apply(out), text);
  }
}
