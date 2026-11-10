/**
 * A person's message split into what the bubble renders: plain text,
 * ``@path`` file references, and pasted code snippets.
 */

import { CodePasteBlock } from "./codePaste";

/** ``key`` is the React key the token renders under. It stays the same
 *  while the text before the token does, so a pill keeps its state as a
 *  message re-renders. */
export type UserTextToken =
  | { kind: "text"; text: string }
  | { kind: "file"; path: string; key: string }
  | { kind: "codePaste"; block: CodePasteBlock; key: string };

export class UserTextTokenizer {
  /** ``@path`` at the start or after whitespace; the whitespace is not
   *  part of the token. Read only through ``matchAll``. */
  private static readonly AT_PATH = /(?:^|\s)@(\S+)/g;

  /** Never empty: a message with nothing in it is one empty text token. */
  static tokenize(text: string): UserTextToken[] {
    const tokens: UserTextToken[] = [];
    let last = 0;
    for (const match of text.matchAll(CodePasteBlock.PATTERN)) {
      const start = match.index ?? 0;
      if (start > last) tokens.push(...UserTextTokenizer.pills(text.slice(last, start), tokens.length));
      tokens.push({ kind: "codePaste", block: CodePasteBlock.fromMatch(match), key: `cp-${start}` });
      last = start + match[0].length;
    }
    if (last < text.length) tokens.push(...UserTextTokenizer.pills(text.slice(last), tokens.length));
    return tokens.length ? tokens : [{ kind: "text", text }];
  }

  /** The text and file tokens of a stretch with no snippets in it.
   *  ``keyOffset`` is how many tokens come before it. */
  private static pills(text: string, keyOffset: number): UserTextToken[] {
    const tokens: UserTextToken[] = [];
    let last = 0;
    for (const match of text.matchAll(UserTextTokenizer.AT_PATH)) {
      const index = match.index ?? 0;
      const start = match[0].startsWith("@") ? index : index + 1;
      if (start > last) tokens.push({ kind: "text", text: text.slice(last, start) });
      tokens.push({ kind: "file", path: match[1], key: `pill-${keyOffset}-${start}` });
      last = index + match[0].length;
    }
    if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
    return tokens;
  }
}
