import { describe, expect, it } from "vitest";

import { ActivityDisclosure } from "./activityDisclosure";
import { activitySteps, baseName, editedFiles, liveStepIndexes, tailLines, visibleSteps } from "./activitySteps";
import type { ChatItem, ToolItem, ToolStatus } from "./chatItem";

let nextId = 1;
const tool = (name: string, args: string, status: ToolStatus = "done"): ToolItem => ({
  kind: "tool",
  id: nextId++,
  runId: "r",
  name,
  args,
  status,
  result: "",
  isError: status === "error",
  diffRows: null,
});
const thinking = (text: string): ChatItem => ({ kind: "thinking", id: nextId++, text });
const agent = (text: string): ChatItem => ({ kind: "agent", id: nextId++, text });

describe("activitySteps", () => {
  it("labels each step and says how it went", () => {
    const steps = activitySteps(
      [thinking("a"), tool("Bash", "ls"), tool("Edit", ""), tool("Bash", "x", "error"), tool("Bash", "y", "rejected"), agent("Delegated to coder")],
      false,
    );
    expect(steps.map((s) => [s.index, s.glyph, s.state, s.label])).toEqual([
      [0, "thinking", "done", "Thought"],
      [1, "command", "done", "Bash ls"],
      [2, "edit", "done", "Edit"],
      [3, "command", "failed", "Bash x"],
      [4, "command", "rejected", "Bash y"],
      [5, "agent", "done", "Delegated to coder"],
    ]);
  });

  it("is live on a waiting tool and on the running group's last thought or marker", () => {
    expect(liveStepIndexes([tool("Read", "a", "running"), tool("Bash", "b", "running")], true)).toEqual([0, 1]);
    expect(liveStepIndexes([tool("Read", "a"), thinking("t")], true)).toEqual([1]);
    expect(liveStepIndexes([tool("Read", "a"), agent("x")], true)).toEqual([1]);
    expect(liveStepIndexes([thinking("t"), tool("Read", "a")], true)).toEqual([]);
    expect(liveStepIndexes([tool("Read", "a", "running"), thinking("t")], false)).toEqual([]);
    expect(activitySteps([thinking("t")], true)[0].label).toBe("Thinking");
    // A tool the turn left waiting, once the turn is over, is not live.
    expect(activitySteps([tool("Bash", "x", "running")], false)[0].state).toBe("done");
  });
});

describe("visibleSteps", () => {
  it("keeps the last ones and counts the rest, one slot for the count", () => {
    const all = [1, 2, 3, 4, 5];
    expect(visibleSteps(all, 5)).toEqual({ hidden: 0, shown: all });
    expect(visibleSteps(all, 4)).toEqual({ hidden: 2, shown: [3, 4, 5] });
    expect(visibleSteps(all, 1)).toEqual({ hidden: 4, shown: [5] });
  });
});

describe("tailLines", () => {
  it("keeps the last non-empty lines", () => {
    expect(tailLines("a\n\nb\nc\nd\n\n", 3)).toEqual(["b", "c", "d"]);
    expect(tailLines("only", 3)).toEqual(["only"]);
    expect(tailLines("  \n ", 3)).toEqual([]);
    expect(tailLines("a\nb\nc", 2)).toEqual(["b", "c"]);
  });

  it("reads a long text from its end, from a whole word", () => {
    const text = `${"abcdefghij".repeat(100)} tail words here`;
    const [line] = tailLines(text, 3);
    expect(line.length).toBeLessThanOrEqual(360);
    expect(line).toBe("tail words here");
    const words = `${"lorem ".repeat(200)}end`;
    const [w] = tailLines(words, 3);
    expect(w.startsWith("lorem")).toBe(true);
    expect(w.endsWith("end")).toBe(true);
  });
});

describe("editedFiles", () => {
  it("lists each file a finished edit changed, once", () => {
    expect(
      editedFiles([
        tool("Edit", "a.ts"),
        tool("edit_file", "b.ts (2 replacements)"),
        tool("Edit", "a.ts"),
        tool("Edit", "c.ts", "error"),
        tool("Edit", "d.ts", "running"),
        tool("Read", "e.ts"),
        tool("Edit", "  "),
      ]),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("names a file by its last part", () => {
    expect(["src/a/b.tsx", "C:\\x\\y.ts", "plain", "dir/"].map(baseName)).toEqual(["b.tsx", "y.ts", "plain", "dir"]);
  });
});

describe("ActivityDisclosure.stepClocks", () => {
  it("clocks each step from when it is seen live to when it is not", () => {
    const store = new ActivityDisclosure(null);
    store.stepClocks("g", [], 1);
    expect(store.stepTime("g", 0)).toBeNull();
    store.stepClocks("g", [0], 10);
    store.stepClocks("g", [0], 15);
    expect(store.stepTime("g", 0)).toEqual({ start: 10, end: null });
    store.stepClocks("g", [1], 20);
    expect(store.stepTime("g", 0)).toEqual({ start: 10, end: 20 });
    expect(store.stepTime("g", 1)).toEqual({ start: 20, end: null });
    store.stepClocks("g", [], 32);
    expect(store.stepTime("g", 1)).toEqual({ start: 20, end: 32 });
    // Seen again with nothing live: nothing moves.
    store.stepClocks("g", [], 50);
    expect(store.stepTime("g", 1)).toEqual({ start: 20, end: 32 });
    // A group's steps are its own.
    expect(store.stepTime("h", 1)).toBeNull();
    expect(store.clock("g", false, 60)).toBeNull();
  });
});
