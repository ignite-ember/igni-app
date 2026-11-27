import { describe, expect, it } from "vitest";

import { ActivityDisclosure } from "./activityDisclosure";
import {
  activitySteps,
  baseName,
  editedFiles,
  exitCodeOf,
  fitMarkers,
  headlineStep,
  latestThought,
  liveStepIndexes,
  stepResultText,
  tailLines,
} from "./activitySteps";
import type { ChatItem, ToolItem, ToolStatus } from "./chatItem";

let nextId = 1;
const tool = (name: string, args: string, status: ToolStatus = "done", result = ""): ToolItem => ({
  kind: "tool",
  id: nextId++,
  runId: "r",
  name,
  args,
  status,
  result,
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

describe("fitMarkers", () => {
  // 22 px a marker, 4 between, 35 for the "+k".
  const fit = (width: number, count: number) => fitMarkers(width, count, 22, 4, 35);

  it("shows them all while they fit, to the last pixel", () => {
    expect(fit(22 * 22 + 21 * 4, 22)).toBe(22);
    expect(fit(740, 22)).toBe(22);
    expect(fit(22, 1)).toBe(1);
    expect(fit(500, 0)).toBe(0);
  });

  it("folds the earliest into +k only when the width runs out, keeping room for it", () => {
    expect(fit(22 * 22 + 21 * 4 - 1, 22)).toBe(20);
    // (300 - 35 + 4) / 26 = 10.3
    expect(fit(300, 22)).toBe(10);
    expect(fit(10, 22)).toBe(1);
  });

  it("shows them all before the strip is measured", () => {
    expect(fit(0, 40)).toBe(40);
  });
});

describe("exitCodeOf", () => {
  it("reads the exit code the way igni-core's shell tools say it", () => {
    expect(exitCodeOf("Command exited with code 2:\nboom")).toBe(2);
    expect(exitCodeOf("[Finished — exit code 0]\nok")).toBe(0);
    expect(exitCodeOf("Background process exited with code 137:\n")).toBe(137);
    expect(exitCodeOf("Exit code: -1")).toBe(-1);
    expect(exitCodeOf(`${"x\n".repeat(400)}exit code 3`)).toBe(3);
  });

  it("says nothing when the output does not", () => {
    expect(exitCodeOf("")).toBeNull();
    expect(exitCodeOf("12 passed")).toBeNull();
    // Only the ends are read: a code in the middle of a long log is a line of it.
    expect(exitCodeOf(`${"a".repeat(300)} exit code 4 ${"b".repeat(300)}`)).toBeNull();
  });

  it("is a finished command's only", () => {
    const [bash, read, live] = activitySteps(
      [tool("Bash", "x", "error", "Command exited with code 1:\n"), tool("Read", "f", "done", "exit code 1"), tool("Bash", "y", "running", "exit code 5")],
      true,
    );
    expect([bash.exitCode, read.exitCode, live.exitCode]).toEqual([1, null, null]);
  });
});

describe("stepResultText", () => {
  it("says how each step went", () => {
    const steps = activitySteps(
      [
        tool("Bash", "a", "error", "Command exited with code 1:\n"),
        tool("Bash", "b", "error", "boom"),
        tool("Bash", "c", "done", "[Finished — exit code 0]"),
        tool("Read", "d"),
        tool("Bash", "e", "rejected"),
        thinking("t"),
        agent("→ helper"),
        tool("Bash", "f", "running"),
      ],
      true,
    );
    expect(steps.map(stepResultText)).toEqual([
      "failed · exit 1",
      "failed",
      "done",
      "done",
      "not run",
      null,
      null,
      "running",
    ]);
    expect(stepResultText(activitySteps([thinking("t")], true)[0])).toBeNull();
  });
});

describe("latestThought and headlineStep", () => {
  it("finds the group's last thought, and whether it still streams", () => {
    expect(latestThought(activitySteps([tool("Read", "a")], true))).toBeNull();
    expect(latestThought(activitySteps([thinking("one"), tool("Read", "a"), thinking("  ")], false))).toEqual({
      text: "one",
      live: false,
    });
    expect(latestThought(activitySteps([thinking("one"), thinking("two")], true))).toEqual({ text: "two", live: true });
  });

  it("names the running tool, else the last step", () => {
    const steps = activitySteps([tool("Bash", "a", "running"), thinking("t")], true);
    expect(headlineStep(steps)?.label).toBe("Bash a");
    expect(headlineStep(activitySteps([tool("Read", "a"), tool("Bash", "b", "error")], true))?.label).toBe("Bash b");
    expect(headlineStep([])).toBeNull();
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
