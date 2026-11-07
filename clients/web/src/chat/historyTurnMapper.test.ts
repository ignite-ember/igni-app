import { beforeEach, describe, expect, it } from "vitest";
import { parseHistoryTurn, type StatsTurn } from "../protocol/historyTurns";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { HistoryTurnMapper } from "./historyTurnMapper";

let history: HistoryTurnMapper;
beforeEach(() => {
  history = new HistoryTurnMapper(new ChatItemFactory(new ChatItemIds()));
});

const restoredItem = (raw: Record<string, unknown>) => history.map(parseHistoryTurn(raw));

function statsTurn(raw: Record<string, unknown>): StatsTurn {
  const turn = parseHistoryTurn({ ...raw, role: "stats" });
  if (turn.role !== "stats") throw new Error("not a stats turn");
  return turn;
}

const restoredStatsItem = (raw: Record<string, unknown>, visibleOutText: string) =>
  history.stats(statsTurn(raw), visibleOutText);

describe("HistoryTurnMapper#map", () => {
  it("restores a rejected tool call as rejected", () => {
    const item = restoredItem({
      role: "tool",
      tool_name: "run_shell_command",
      friendly_name: "Bash",
      content: "Not run: the user rejected this call when asked to approve it.",
      is_rejected: true,
    });
    expect(item).toMatchObject({ kind: "tool", status: "rejected" });
  });

  it("strips injected system-context from user turns", () => {
    const item = restoredItem({
      role: "user",
      content:
        "<system-context>Current datetime: 2026-06-11 14:42 CEST</system-context>\nCount to 20.",
    });
    expect(item).toMatchObject({ kind: "user", text: "Count to 20." });
  });

  it("strips closed think blocks from assistant turns", () => {
    const item = restoredItem({
      role: "assistant",
      content: "<think>plan it out</think>\nDone. Created notes.txt.",
    });
    expect(item).toMatchObject({ kind: "assistant", text: "Done. Created notes.txt." });
  });

  it("strips a trailing unclosed think block (cancelled run)", () => {
    const item = restoredItem({
      role: "assistant",
      content: "Partial answer.\n<think>was still reason",
    });
    expect(item).toMatchObject({ kind: "assistant", text: "Partial answer." });
  });

  it("renders a /loop iteration as a structured loop item, not a raw user bubble", () => {
    const wrapped =
      '<loop-iteration index="3" total="5">\n' +
      "Autonomous loop iteration — do not ask the user; perform one unit of work and stop. " +
      "Tool-permission prompts are the only legitimate user interaction.\n\n" +
      "When you can determine the total number of items (e.g. after listing files or parsing the input), " +
      "call loop_set_total(N) once so the panel renders progress as N/total. " +
      "Call loop_stop() when all work is done — don't keep looping just because the safety cap hasn't been hit.\n\n" +
      "process file 3\n" +
      "</loop-iteration>";
    const item = restoredItem({ role: "user", content: wrapped });
    expect(item?.kind).toBe("loop");
    if (item?.kind === "loop") {
      expect(item.index).toBe(3);
      expect(item.total).toBe(5);
      expect(item.body).toBe("process file 3");
    }
  });

  it("returns null when nothing remains or role is unknown", () => {
    expect(restoredItem({ role: "assistant", content: "<think>only thoughts</think>" })).toBeNull();
    expect(restoredItem({ role: "user", content: "  " })).toBeNull();
    expect(restoredItem({ role: "system", content: "boot" })).toBeNull();
  });

  it("restores a thinking turn into a thinking ChatItem", () => {
    const item = restoredItem({
      role: "thinking",
      content: "let me reason through this carefully…",
    });
    expect(item).toMatchObject({
      kind: "thinking",
      text: "let me reason through this carefully…",
    });
  });

  it("returns null for an empty thinking turn", () => {
    expect(restoredItem({ role: "thinking", content: "   " })).toBeNull();
  });

  it("restores a tool turn into a done tool ChatItem", () => {
    const item = restoredItem({
      role: "tool",
      tool_name: "run_shell_command",
      friendly_name: "Bash",
      args: "command=ls -la",
      content: "drwxr-xr-x  6 user  staff   192 ...\n",
      is_error: false,
      run_id: "r1",
    });
    expect(item).toMatchObject({
      kind: "tool",
      name: "Bash",
      args: "command=ls -la",
      status: "done",
      isError: false,
      runId: "r1",
    });
    if (item?.kind === "tool") {
      expect(item.result).toContain("drwxr-xr-x");
    }
  });

  it("marks restored tool turns with tool_call_error as error", () => {
    const item = restoredItem({
      role: "tool",
      tool_name: "edit_file",
      friendly_name: "Edit",
      args: "file_path=missing.py",
      content: "Error: file not found",
      is_error: true,
      run_id: "r1",
    });
    expect(item).toMatchObject({ kind: "tool", status: "error", isError: true });
  });

  it("restores a plan turn with its decided state set at construction", () => {
    const item = restoredItem({
      role: "plan",
      plan: "  do the thing  ",
      tasks: [{ content: "a", status: "completed" }, null],
      state: "approved",
      run_id: "r1",
    });
    expect(item).toMatchObject({
      kind: "plan",
      plan: "do the thing",
      state: "approved",
      runId: "r1",
      tasks: [{ content: "a", status: "completed", activeForm: "" }],
    });
  });

  it("keeps an unknown plan state pending, and drops an empty plan", () => {
    expect(restoredItem({ role: "plan", plan: "p", state: "weird" })).toMatchObject({
      state: "pending",
    });
    expect(restoredItem({ role: "plan", plan: "   " })).toBeNull();
  });

  it("restores a visualization turn, and drops one without a spec", () => {
    expect(
      restoredItem({ role: "visualization", spec_id: "s1", spec: { root: "r" }, title: "T" }),
    ).toMatchObject({ kind: "visualization", specId: "s1", title: "T", sourceAgent: "visualizer" });
    expect(restoredItem({ role: "visualization", spec_id: "s1", spec: "nope" })).toBeNull();
    expect(restoredItem({ role: "visualization", spec: { root: "r" } })).toBeNull();
  });

  it("returns null for a stats turn (it goes through stats())", () => {
    expect(restoredItem({ role: "stats", input_tokens: 1 })).toBeNull();
  });

  it("gives each restored item its own id from the shared allocator", () => {
    const a = restoredItem({ role: "user", content: "one" });
    const b = restoredItem({ role: "assistant", content: "two" });
    expect(a?.id).toBe(1);
    expect(b?.id).toBe(2);
  });
});

// ── HistoryTurnMapper#stats ──────────────────────────────────────
//
// Builds a stats ChatItem from a persisted-history ``stats``
// turn the BE emits in ``get_chat_history``. The BE keys are
// integers/floats normally but defensive Number coercion
// handles None / missing / string-encoded shapes from older
// Agno serialisations.

describe("HistoryTurnMapper#stats", () => {
  it("reads the standard numeric fields", () => {
    const out = restoredStatsItem(
      {
        run_id: "abc",
        input_tokens: 1000,
        output_tokens: 200,
        reasoning_tokens: 50,
        duration: 3.4,
      },
      "rendered assistant text",
    );
    expect(out.kind).toBe("stats");
    if (out.kind !== "stats") return;
    expect(out.runId).toBe("abc");
    expect(out.inputTokens).toBe(1000);
    expect(out.outputTokens).toBe(200);
    expect(out.reasoningTokens).toBe(50);
    expect(out.duration).toBe(3.4);
  });

  it("defaults missing fields to 0 (not NaN)", () => {
    // The Number(turn[k] ?? 0) || 0 pattern guards against
    // NaN from string fields the agent might have persisted.
    // NaN in inputTokens would render as "NaN tokens" in the
    // badge.
    const out = restoredStatsItem({}, "");
    if (out.kind !== "stats") return;
    expect(out.inputTokens).toBe(0);
    expect(out.outputTokens).toBe(0);
    expect(out.reasoningTokens).toBe(0);
    expect(out.duration).toBe(0);
  });

  it("coerces string numeric values", () => {
    // Older Agno serialisations carried integers as strings;
    // the Number() coercion handles them.
    const out = restoredStatsItem(
      { input_tokens: "1000", output_tokens: "200" },
      "",
    );
    if (out.kind !== "stats") return;
    expect(out.inputTokens).toBe(1000);
    expect(out.outputTokens).toBe(200);
  });

  it("coerces null to 0", () => {
    // ``null`` falls to ``Number(null) === 0``; the ``|| 0``
    // tail handles the NaN-from-arbitrary-string case.
    const out = restoredStatsItem({ input_tokens: null }, "");
    if (out.kind !== "stats") return;
    expect(out.inputTokens).toBe(0);
  });

  it("coerces non-numeric strings to 0 (NOT NaN)", () => {
    // The ``|| 0`` fallback catches NaN. Without it, the
    // stats badge would render "NaN" — visible bug.
    const out = restoredStatsItem({ input_tokens: "garbage" }, "");
    if (out.kind !== "stats") return;
    expect(out.inputTokens).toBe(0);
  });

  it("coerces non-string runId to string", () => {
    // ``runId`` is typed as string but the persisted shape
    // might surface it as a number. ``String()`` keeps the
    // type contract.
    const out = restoredStatsItem({ run_id: 12345 }, "");
    if (out.kind !== "stats") return;
    expect(out.runId).toBe("12345");
    expect(typeof out.runId).toBe("string");
  });

  it("defaults missing runId to empty string", () => {
    const out = restoredStatsItem({}, "");
    if (out.kind !== "stats") return;
    expect(out.runId).toBe("");
  });

  it("visibleThinkTokens is always 0 on restore (thinking stripped)", () => {
    // Persisted history strips ``<think>…</think>`` blocks
    // from assistant turns, so by construction the restored
    // ``out`` text has no thinking content.
    const out = restoredStatsItem(
      { input_tokens: 100, output_tokens: 50 },
      "any rendered text",
    );
    if (out.kind !== "stats") return;
    expect(out.visibleThinkTokens).toBe(0);
  });

  it("is marked corrected:true (no live RPC will patch it)", () => {
    // Historical stats land already-corrected — the
    // count_context_tokens RPC only fires for live runs. The
    // badge therefore renders without the "estimating…"
    // affordance.
    const out = restoredStatsItem({ input_tokens: 100 }, "");
    if (out.kind !== "stats") return;
    expect(out.corrected).toBe(true);
  });
});

describe("a message an extension posted", () => {
  it("restores labelled as the extension's, out of its history wrapper", () => {
    const content =
      "<system-context>\nThe message below was posted by the igni extension 'acme.reviewer', not typed by the person.\n</system-context>\n" +
      '<extension-message from="acme.reviewer">\nTwo issues in auth.py.\n</extension-message>';
    const item = restoredItem({ role: "user", content });
    expect(item).toMatchObject({
      kind: "user",
      text: "Two issues in auth.py.",
      fromExtension: "acme.reviewer",
    });
  });

  it("leaves the person's own messages unlabelled", () => {
    const item = restoredItem({ role: "user", content: "hello" });
    expect(item).toMatchObject({ kind: "user", text: "hello" });
    expect(item && "fromExtension" in item).toBe(false);
  });
});

