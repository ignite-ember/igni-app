import { beforeEach, describe, expect, it } from "vitest";

import type { ServerMessage } from "../protocol/messages";
import {
  countActivity,
  currentStep,
  stepKindOf,
  summaryText,
  TranscriptRows,
  type ActivityRow,
  type TranscriptRow,
} from "./activityGroups";
import type { ChatItem, ToolItem, ToolStatus } from "./chatItem";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { ChatTranscript } from "./chatTranscript";

let f: ChatItemFactory;
beforeEach(() => {
  f = new ChatItemFactory(new ChatItemIds());
});

const tool = (name: string, args = "", status: ToolStatus = "done", runId = "run-1"): ToolItem => ({
  ...f.runningTool({ type: "tool_started", tool_name: name, friendly_name: name, args_summary: args, run_id: runId }),
  status,
});

const user = (runId?: string): ChatItem => ({ ...f.user("hi"), ...(runId ? { runId } : {}) });

/** Each row as ``group(<kinds>)`` or the item's kind. */
const shape = (rows: TranscriptRow[]): string[] =>
  rows.map((r) => (r.kind === "activity" ? `group(${r.group.items.map((i) => i.kind).join(",")})` : r.item.kind));

const groups = (rows: TranscriptRow[]): ActivityRow[] =>
  rows.filter((r): r is ActivityRow => r.kind === "activity");

describe("TranscriptRows.of", () => {
  it("gathers consecutive tools and thinking into one group", () => {
    const rows = TranscriptRows.of([user("r"), f.thinking("hm"), tool("Bash"), tool("Read"), f.thinking("ok")]).rows;
    expect(shape(rows)).toEqual(["user", "group(thinking,tool,tool,thinking)"]);
  });

  it("splits groups at the assistant's text", () => {
    const rows = TranscriptRows.of([
      user("r"),
      tool("Bash"),
      f.assistant("first"),
      tool("Read"),
      f.thinking("t"),
      f.assistant("second"),
    ]).rows;
    expect(shape(rows)).toEqual(["user", "group(tool)", "assistant", "group(tool,thinking)", "assistant"]);
  });

  it("splits groups at a user message", () => {
    const rows = TranscriptRows.of([user("a"), tool("Bash"), user("b"), tool("Read")]).rows;
    expect(shape(rows)).toEqual(["user", "group(tool)", "user", "group(tool)"]);
  });

  it("keeps a plan card, an error and a team card outside, as rows of their own", () => {
    const team = f.orchestrate("card", { agents: {}, order: [] } as never);
    const rows = TranscriptRows.of([
      user("r"),
      tool("Bash"),
      f.plan({ plan: "do it" }),
      tool("Read"),
      f.error("boom"),
      tool("Grep"),
      team,
    ]).rows;
    expect(shape(rows)).toEqual(["user", "group(tool)", "plan", "group(tool)", "error", "group(tool)", "orchestrate"]);
  });

  it("makes no group from an empty run", () => {
    const rows = TranscriptRows.of([user("r"), f.assistant("a"), f.assistant("b")]).rows;
    expect(groups(rows)).toHaveLength(0);
    expect(TranscriptRows.of([]).rows).toEqual([]);
  });

  it("gathers a sub-agent's marker with the tools around it", () => {
    const rows = TranscriptRows.of([user("r"), tool("Agent"), f.agent("researcher"), tool("Read")]).rows;
    expect(shape(rows)).toEqual(["user", "group(tool,agent,tool)"]);
  });

  it("keys a group by its turn's run and its place in it, the same however the list grows", () => {
    const items = [user("run-a"), tool("Bash"), f.assistant("x"), f.thinking("t")];
    const first = groups(TranscriptRows.of(items).rows).map((g) => g.group.key);
    expect(first).toEqual(["run-a:0", "run-a:1"]);
    const grown = groups(TranscriptRows.of([...items, tool("Read"), f.assistant("y")]).rows);
    expect(grown.map((g) => g.group.key)).toEqual(["run-a:0", "run-a:1"]);
  });

  it("keys by the tools' run when the user message has none, and by item id when nothing has one", () => {
    const fromTool = groups(TranscriptRows.of([user(), f.thinking("t"), tool("Bash", "", "done", "run-t")]).rows);
    expect(fromTool[0].group.key).toBe("run-t:0");
    const think = f.thinking("t");
    const bare = groups(TranscriptRows.of([user(), think]).rows);
    expect(bare[0].group.key).toBe(`item:${think.id}`);
  });

  it("marks only the last group as the tail, past a queued message", () => {
    const rows = TranscriptRows.of([
      user("r"),
      tool("Bash"),
      f.assistant("x"),
      tool("Read"),
      f.queuedUser("later"),
      f.queuedNote("Queued"),
    ]).rows;
    expect(groups(rows).map((g) => g.group.tail)).toEqual([false, true]);
    const closed = TranscriptRows.of([user("r"), tool("Bash"), f.assistant("done")]).rows;
    expect(groups(closed)[0].group.tail).toBe(false);
  });

  it("maps items to rows and back", () => {
    const items = [user("r"), tool("Bash"), tool("Read"), f.assistant("x")];
    const rows = TranscriptRows.of(items);
    expect([0, 1, 2, 3].map((i) => rows.rowOfItem(i))).toEqual([0, 1, 1, 2]);
    expect([0, 1, 2].map((r) => rows.itemOfRow(r))).toEqual([0, 1, 3]);
    expect(rows.rowOfItem(99)).toBe(2);
    expect(rows.groupOfItemId(items[2].id)?.key).toBe("r:0");
    expect(rows.groupOfItemId(items[3].id)).toBeNull();
  });

  it("streams new tools and thinking into the open group in place", () => {
    const factory = new ChatItemFactory(new ChatItemIds());
    let t = new ChatTranscript([{ ...factory.user("go"), runId: "run-s" }], factory);
    const apply = (m: Partial<ServerMessage> & { type: string }) => {
      t = t.applyServerMessage({ id: "run-s", run_id: "run-s", ...m } as ServerMessage);
    };
    apply({ type: "content_delta", text: "let me ", is_thinking: true });
    apply({ type: "content_delta", text: "look", is_thinking: true });
    let rows = TranscriptRows.of(t.items).rows;
    expect(shape(rows)).toEqual(["user", "group(thinking)"]);
    const key = groups(rows)[0].group.key;

    apply({ type: "tool_started", tool_name: "read_file", friendly_name: "Read", args_summary: "a.ts" });
    rows = TranscriptRows.of(t.items).rows;
    expect(shape(rows)).toEqual(["user", "group(thinking,tool)"]);
    expect(groups(rows)[0].group.key).toBe(key);
    expect(groups(rows)[0].group.tail).toBe(true);

    apply({ type: "content_delta", text: "Done.", is_thinking: false });
    apply({ type: "tool_started", tool_name: "grep", friendly_name: "Grep", args_summary: "x" });
    rows = TranscriptRows.of(t.items).rows;
    expect(shape(rows)).toEqual(["user", "group(thinking,tool)", "assistant", "group(tool)"]);
    expect(groups(rows).map((g) => g.group.tail)).toEqual([false, true]);
  });
});

describe("activity counts and summary", () => {
  it("sorts tools by step kind, raw or display name", () => {
    expect(["Bash", "run_shell_command", "Read", "Edit", "Write", "Grep", "WebFetch", "Agent", "linear"].map(stepKindOf))
      .toEqual(["command", "command", "read", "edit", "edit", "search", "fetch", "agent", "other"]);
  });

  it("says what a finished group did", () => {
    const c = countActivity([
      tool("Bash"),
      tool("Bash"),
      tool("Bash"),
      tool("Bash"),
      tool("Read"),
      tool("Read"),
      tool("read_file"),
      f.thinking("a"),
    ]);
    expect(summaryText(c)).toBe("Ran 4 commands, read 3 files, thought");
    expect(c.steps).toBe(8);
  });

  it("names every kind, with singulars", () => {
    const c = countActivity([
      tool("Edit"),
      tool("Grep"),
      tool("WebFetch"),
      tool("Agent"),
      tool("linear"),
      f.thinking("a"),
      f.thinking("b"),
    ]);
    expect(summaryText(c)).toBe(
      "Edited 1 file, ran 1 search, fetched 1 page, started 1 agent, used 1 tool, thought 2 times",
    );
  });

  it("counts failures and running tools", () => {
    const c = countActivity([tool("Bash", "", "error"), tool("Read", "", "error"), tool("Grep", "", "running"), tool("Edit", "", "rejected")]);
    expect(c.failed).toBe(2);
    expect(c.runningTools).toBe(1);
  });

  it("falls back to a step count when no kind applies", () => {
    expect(summaryText(countActivity([f.agent("x")]))).toBe("Started 1 agent");
    expect(summaryText({ ...countActivity([]), steps: 3 })).toBe("3 steps");
  });

  it("puts a running group on its running tool, else its last item", () => {
    const running = tool("Bash", "npm test", "running");
    expect(currentStep([running, f.thinking("t")])).toEqual({ kind: "tool", item: running });
    expect(currentStep([tool("Read"), f.thinking("t")])?.kind).toBe("thinking");
    expect(currentStep([f.agent("helper")])).toEqual({ kind: "agent", text: "→ helper" });
    expect(currentStep([])).toBeNull();
  });
});
