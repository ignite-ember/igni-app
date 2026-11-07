/**
 * The edit-mode round-trip for ``[code-paste …]…[/code-paste]`` blocks,
 * and the tokenizer that finds them in a user bubble.
 *
 * The person sees compact ``«code:foo.py 9-12#1»`` placeholders in the
 * textarea so they can reorder snippets but not corrupt them; saving
 * swaps each surviving placeholder back. The invariant:
 * ``restore(swap(x))`` is identity when nothing changed in between.
 */

import { describe, expect, it } from "vitest";
import { CodePasteBlock, CodePastePlaceholders } from "./codePaste";
import { UserTextTokenizer } from "./userTextTokens";

describe("CodePastePlaceholders swap + restore", () => {
  const sample = `before
[code-paste src/foo.py:9 lines=9-12]
def hello():
    return 1
[/code-paste]
middle
[code-paste src/bar.ts:42 lines=42-44]
const x = 1;
[/code-paste]
after`;

  it("swap returns text with each block replaced by a single placeholder", () => {
    const store = new CodePastePlaceholders();
    const swapped = store.swap(sample);
    // No raw ``[code-paste`` left in the swapped text — the
    // textarea must never show the full block during edit.
    expect(swapped).not.toContain("[code-paste");
    expect(swapped).not.toContain("[/code-paste]");
    // Both placeholders captured in the store.
    expect(store.size).toBe(2);
  });

  it("placeholder includes the filename and lines so the user can ID it", () => {
    // Without the filename + line span, two snippets from the
    // same file would be visually indistinguishable in the
    // textarea — couldn't reorder safely.
    const store = new CodePastePlaceholders();
    const swapped = store.swap(sample);
    expect(swapped).toContain("«code:foo.py 9-12#1»");
    expect(swapped).toContain("«code:bar.ts 42-44#2»");
  });

  it("restore is the exact inverse when text is untouched (identity round-trip)", () => {
    // Load-bearing: an unchanged edit must NOT mutate the
    // original message body. Any drift would corrupt the
    // saved turn.
    const store = new CodePastePlaceholders();
    const swapped = store.swap(sample);
    const restored = store.restore(swapped);
    expect(restored).toBe(sample);
  });

  it("removing a placeholder removes the corresponding snippet on save", () => {
    // The product behavior: cut-and-delete the «code» token in
    // the textarea, hit save → the snippet vanishes from the
    // saved message. (User can pare back over-eager attachment.)
    const store = new CodePastePlaceholders();
    let swapped = store.swap(sample);
    // User deletes the second placeholder + its surrounding
    // newline:
    swapped = swapped.replace("«code:bar.ts 42-44#2»\nafter", "after");
    const restored = store.restore(swapped);
    expect(restored).toContain("def hello()");
    expect(restored).not.toContain("const x = 1");
    expect(restored).toContain("after");
  });

  it("reordering placeholders reorders the snippets", () => {
    const store = new CodePastePlaceholders();
    const swapped = store.swap(sample);
    // User swaps the two placeholders.
    const ph1 = "«code:foo.py 9-12#1»";
    const ph2 = "«code:bar.ts 42-44#2»";
    const reordered = swapped.replace(ph1, "TMP").replace(ph2, ph1).replace("TMP", ph2);
    const restored = store.restore(reordered);
    const fooIdx = restored.indexOf("def hello()");
    const barIdx = restored.indexOf("const x = 1");
    expect(fooIdx).toBeGreaterThan(barIdx);
  });

  it("clears the placeholders on each new swap (no leakage between edits)", () => {
    // A reused instance must not carry a prior message's
    // placeholders into the next edit and "restore" them into the
    // wrong text.
    const store = new CodePastePlaceholders();
    store.swap(sample);
    store.swap("just plain text");
    expect(store.size).toBe(0);
  });

  it("restore preserves placeholder-less text untouched", () => {
    const store = new CodePastePlaceholders();
    expect(store.restore("hello world")).toBe("hello world");
  });

  it("restore drops placeholders absent from the store as empty (lost-snippet recovery)", () => {
    // If the user pastes a token from a DIFFERENT message,
    // we can't reconstruct it — render as empty (nothing
    // weirder than a literal «code:…» token leaking into the
    // saved turn).
    const store = new CodePastePlaceholders();
    expect(store.restore("a «code:ghost.py 1-2#7» b")).toBe("a  b");
  });
});

describe("CodePasteBlock", () => {
  it("names the file and the first contiguous range", () => {
    const block = new CodePasteBlock("src/a/foo.py", 9, "9,11-13", "x", "raw");
    expect(block.fileName).toBe("foo.py");
    expect(block.firstRange).toBe("9");
    expect(new CodePasteBlock("foo.py", 71, "71-75", "x", "raw").firstRange).toBe("71-75");
  });
});

describe("UserTextTokenizer", () => {
  const paste = "[code-paste src/foo.py:9 lines=9-12]\ndef hello():\n    return 1\n[/code-paste]";

  it("splits text, file references and snippets in order", () => {
    const tokens = UserTextTokenizer.tokenize(`see @src/a.ts and ${paste} done`);
    expect(tokens.map((t) => t.kind)).toEqual(["text", "file", "text", "codePaste", "text"]);
    expect(tokens[0]).toEqual({ kind: "text", text: "see " });
    expect(tokens[1]).toEqual({ kind: "file", path: "src/a.ts", key: "pill-0-4" });
    const snippet = tokens[3];
    expect(snippet.kind === "codePaste" && snippet.block.snippet).toBe("def hello():\n    return 1");
    expect(snippet.kind === "codePaste" && snippet.key).toBe("cp-18");
  });

  it("keeps the whitespace before an @path in the text", () => {
    const tokens = UserTextTokenizer.tokenize("a @x b");
    expect(tokens).toEqual([
      { kind: "text", text: "a " },
      { kind: "file", path: "x", key: "pill-0-2" },
      { kind: "text", text: " b" },
    ]);
  });

  it("does not take an @ inside a word as a reference", () => {
    expect(UserTextTokenizer.tokenize("me@example.com")).toEqual([
      { kind: "text", text: "me@example.com" },
    ]);
  });

  it("keys file pills after a snippet by the tokens before them", () => {
    const tokens = UserTextTokenizer.tokenize(`${paste}\n@b.ts`);
    expect(tokens[1]).toEqual({ kind: "text", text: "\n" });
    expect(tokens[2]).toEqual({ kind: "file", path: "b.ts", key: "pill-1-1" });
  });

  it("gives one empty text token for an empty message", () => {
    expect(UserTextTokenizer.tokenize("")).toEqual([{ kind: "text", text: "" }]);
  });

  it("gives the same tokens back to back", () => {
    // The patterns are shared and global; a call that left
    // ``lastIndex`` behind would make the next one skip a match.
    const text = `@a.ts ${paste} @b.ts`;
    const first = UserTextTokenizer.tokenize(text);
    expect(UserTextTokenizer.tokenize(text)).toEqual(first);
    expect(first.filter((t) => t.kind !== "text")).toHaveLength(3);
  });

  it("is unaffected by a swap running in the middle of it", () => {
    const text = `${paste} and ${paste}`;
    const tokens = UserTextTokenizer.tokenize(text);
    new CodePastePlaceholders().swap(text);
    expect(UserTextTokenizer.tokenize(text)).toEqual(tokens);
    expect(tokens.filter((t) => t.kind === "codePaste")).toHaveLength(2);
  });

  it("swaps the same after a tokenize as before it", () => {
    const text = `${paste} and ${paste}`;
    const before = new CodePastePlaceholders().swap(text);
    UserTextTokenizer.tokenize(text);
    expect(new CodePastePlaceholders().swap(text)).toBe(before);
  });
});
