/**
 * The code pills one composer has inserted: each `@code:<id>` token in
 * the draft names a pasted snippet and where it was found.
 *
 * Ids are derived from the content (snippet, file, lines), not counted
 * per mount. The draft outlives the composer — it is `ui.composer` and
 * survives a reload — while this registry does not, so a counted `c1`
 * left in a restored draft used to resolve to whichever snippet was
 * pasted first after the reload. A content id can only resolve to the
 * same content.
 *
 * Entries are kept for the life of the composer on purpose: a message
 * recalled from history still has its pills.
 */

import { CodeMatchSet } from "../../chat/codeMatchSet";
import { CodePasteBlock } from "../../chat/codePaste";

interface CodePill {
  snippet: string;
  matches: CodeMatchSet;
}

/** The draft with every known pill expanded, and the ids it did not know. */
export interface ExpandedDraft {
  text: string;
  missing: string[];
}

/** The draft with a snippet swapped for its pill, and where the caret goes. */
export interface SwappedSnippet {
  text: string;
  caret: number;
}

/** A `@code:<id>` token standing alone as a word, as the editor pills it. */
const TOKEN = /(?:^|(?<=\s))@code:(\S+)(?=\s|$)/g;

export class CodePillRegistry {
  private readonly pills = new Map<string, CodePill>();

  /** The id for this snippet at these matches: the same content always
   *  gets the same id. */
  register(snippet: string, matches: CodeMatchSet): string {
    const base = `c${CodePillRegistry.hash(`${matches.firstPath}\0${matches.lineSpec}\0${snippet}`)}`;
    let id = base;
    for (let n = 2; ; n++) {
      const held = this.pills.get(id);
      if (!held || CodePillRegistry.same(held, snippet, matches)) break;
      id = `${base}-${n}`;
    }
    this.pills.set(id, { snippet, matches });
    return id;
  }

  label(id: string): string | undefined {
    return this.pills.get(id)?.matches.label();
  }

  /** Each token as its `[code-paste …]` block. A token this registry does
   *  not know is dropped and reported in `missing`. */
  expand(text: string): ExpandedDraft {
    const missing: string[] = [];
    const expanded = text.replace(TOKEN, (_token, id: string) => {
      const pill = this.pills.get(id);
      if (!pill) {
        missing.push(id);
        return "";
      }
      return CodePasteBlock.fromMatches(pill.snippet, pill.matches).raw;
    });
    return { text: expanded, missing };
  }

  /** `text` with the first copy of `snippet` replaced by the pill `id`,
   *  padded with spaces so the token stands alone as a word; `null` when
   *  the snippet is no longer there. */
  static swapSnippet(text: string, snippet: string, id: string): SwappedSnippet | null {
    const at = text.indexOf(snippet);
    if (at < 0) return null;
    const before = text.slice(0, at);
    const after = text.slice(at + snippet.length);
    const lead = before === "" || before.endsWith(" ") || before.endsWith("\n") ? "" : " ";
    const trail = after === "" || after.startsWith(" ") || after.startsWith("\n") ? " " : "";
    const token = `${lead}@code:${id}${trail}`;
    return { text: `${before}${token}${after}`, caret: before.length + token.length };
  }

  private static same(pill: CodePill, snippet: string, matches: CodeMatchSet): boolean {
    return (
      pill.snippet === snippet &&
      pill.matches.firstPath === matches.firstPath &&
      pill.matches.lineSpec === matches.lineSpec
    );
  }

  /** 32-bit FNV-1a, as eight hex digits: short enough for a token, and a
   *  clash is resolved by {@link register}. */
  private static hash(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}
