/**
 * Where a pasted snippet was found, as the composer's code pill shows it
 * and the `[code-paste …]` block carries it.
 *
 * `search_code` reports one row per hit, possibly across several files.
 * The pill anchors on the first file and folds its rows into compact
 * line ranges, so a five-line paste reads `71-75` and two separate hits
 * read `9-16, 20`.
 */

import type { CodeMatch } from "../protocol/composerWire";

export type LineRange = [start: number, end: number];

export class CodeMatchSet {
  private constructor(
    readonly matches: readonly CodeMatch[],
    readonly firstPath: string,
    /** The first file's ranges, sorted, adjacent and overlapping ones merged. */
    readonly ranges: readonly LineRange[],
    /** How many other files matched too. */
    readonly extraFiles: number,
  ) {}

  /** `null` when nothing matched: there is no pill to make. */
  static of(matches: readonly CodeMatch[]): CodeMatchSet | null {
    const first = matches[0];
    if (!first) return null;
    const paths = new Set(matches.map((m) => m.path));
    const ranges = CodeMatchSet.merge(
      matches
        .filter((m) => m.path === first.path)
        // Older backends send no `end_line`: a single-line range, still
        // correct, just less informative.
        .map((m): LineRange => [m.line, Math.max(m.line, m.end_line ?? m.line)]),
    );
    return new CodeMatchSet(matches, first.path, ranges, paths.size - 1);
  }

  private static merge(ranges: LineRange[]): LineRange[] {
    const merged: LineRange[] = [];
    for (const [start, end] of ranges.slice().sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1] + 1) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    }
    return merged;
  }

  /** The line the snippet starts at. */
  get anchor(): number {
    return this.ranges[0][0];
  }

  /** The ranges as the wire carries them: `9-16,20`. */
  get lineSpec(): string {
    return this.rangeTexts().join(",");
  }

  /** What the pill shows: `hello.py 9-16, 20 +1`. */
  label(): string {
    const fileName = this.firstPath.split("/").pop() || this.firstPath;
    const more = this.extraFiles > 0 ? ` +${this.extraFiles}` : "";
    return `${fileName} ${this.rangeTexts().join(", ")}${more}`;
  }

  private rangeTexts(): string[] {
    return this.ranges.map(([s, e]) => (s === e ? String(s) : `${s}-${e}`));
  }
}
