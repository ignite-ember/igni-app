import { describe, expect, it } from "vitest";

import { CodeMatchSet } from "../../chat/codeMatchSet";
import { CodePillRegistry } from "./CodePillRegistry";

const SNIPPET = "def hello():\n    return 42";

const found = (path = "src/hello.py", line = 9, end_line = 10) =>
  CodeMatchSet.of([{ path, line, end_line, preview: "" }])!;

describe("CodePillRegistry", () => {
  it("labels a registered pill and expands it to its code-paste block", () => {
    const registry = new CodePillRegistry();
    const id = registry.register(SNIPPET, found());

    expect(registry.label(id)).toBe("hello.py 9-10");
    expect(registry.expand(`why @code:${id} fails`)).toEqual({
      text: `why [code-paste src/hello.py:9 lines=9-10]\n${SNIPPET}\n[/code-paste] fails`,
      missing: [],
    });
  });

  it("drops a token it does not know, and says which", () => {
    const registry = new CodePillRegistry();

    expect(registry.label("c1")).toBeUndefined();
    expect(registry.expand("see @code:c1 here")).toEqual({ text: "see  here", missing: ["c1"] });
  });

  it("leaves a token that is not a word of its own alone", () => {
    const registry = new CodePillRegistry();

    expect(registry.expand("x@code:c1")).toEqual({ text: "x@code:c1", missing: [] });
  });

  describe("ids", () => {
    it("the same snippet at the same place gets the same id", () => {
      const registry = new CodePillRegistry();

      expect(registry.register(SNIPPET, found())).toBe(registry.register(SNIPPET, found()));
    });

    it("different snippets never share an id", () => {
      const registry = new CodePillRegistry();
      const ids = new Set([
        registry.register(SNIPPET, found()),
        registry.register(`${SNIPPET}\n`, found()),
        registry.register(SNIPPET, found("src/other.py")),
        registry.register(SNIPPET, found("src/hello.py", 30, 31)),
      ]);

      expect(ids.size).toBe(4);
    });

    // The bug the counter had: the draft survives a reload, the registry
    // does not, so `c1` from before the reload named whatever was pasted
    // first after it. A fresh registry must not hand out an id a previous
    // one gave to different content.
    it("a fresh registry does not reuse an id for different content", () => {
      const before = new CodePillRegistry().register(SNIPPET, found());
      const after = new CodePillRegistry();
      const other = after.register("const unrelated = 1;\nexport {};", found("src/x.ts", 1, 2));

      expect(other).not.toBe(before);
      expect(after.expand(`@code:${before}`).missing).toEqual([before]);
    });
  });

  describe("swapSnippet", () => {
    it("pads the token on both sides when the snippet is mid-word", () => {
      expect(CodePillRegistry.swapSnippet("abcSNIPdef", "SNIP", "c1")).toEqual({
        text: "abc @code:c1def",
        caret: 12,
      });
    });

    it("adds no lead after a space or newline, and a trail before one", () => {
      expect(CodePillRegistry.swapSnippet("why SNIP now", "SNIP", "c1")).toEqual({
        text: "why @code:c1  now",
        caret: 13,
      });
      expect(CodePillRegistry.swapSnippet("why\nSNIP", "SNIP", "c1")).toEqual({
        text: "why\n@code:c1 ",
        caret: 13,
      });
    });

    it("at the start of an empty draft the token is all there is", () => {
      expect(CodePillRegistry.swapSnippet("SNIP", "SNIP", "c1")).toEqual({
        text: "@code:c1 ",
        caret: 9,
      });
    });

    it("a snippet no longer in the draft swaps nothing", () => {
      expect(CodePillRegistry.swapSnippet("edited away", "SNIP", "c1")).toBeNull();
    });
  });
});
