import { beforeEach, describe, expect, it } from "vitest";
import { formatStats } from "../components/statsLine";
import type { ServerMessage } from "../protocol/messages";
import type { ChatItem, StatsItem, UserItem } from "./chatItem";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { ChatTranscript } from "./chatTranscript";

const delta = (text: string, is_thinking = false): ServerMessage =>
  ({ type: "content_delta", text, is_thinking }) as ServerMessage;

const toolStarted: ServerMessage = {
  type: "tool_started",
  tool_name: "read_file",
  friendly_name: "Read",
  args_summary: "settings.py",
  run_id: "r1",
} as ServerMessage;

const toolCompleted: ServerMessage = {
  type: "tool_completed",
  summary: "ok",
  full_result: "content",
  run_id: "r1",
  has_markup: false,
  diff_rows: null,
  is_error: false,
} as ServerMessage;

let factory: ChatItemFactory;
beforeEach(() => {
  factory = new ChatItemFactory(new ChatItemIds());
});

const transcript = (items: ChatItem[] = []) => new ChatTranscript(items, factory);

function play(events: ServerMessage[], items: ChatItem[] = []): ChatItem[] {
  return events.reduce((t, e) => t.applyServerMessage(e), transcript(items)).items;
}

describe("ChatTranscript#applyServerMessage", () => {
  it("routes content_delta by is_thinking flag (BE does the parse)", () => {
    const items = play([delta("hidden", true), delta("the answer")]);
    expect(items.map((i) => i.kind)).toEqual(["thinking", "assistant"]);
    expect((items[0] as { text: string }).text).toBe("hidden");
    expect((items[1] as { text: string }).text).toBe("the answer");
  });

  it("BE pre-classifies chunks; the FE routes by is_thinking", () => {
    const items = play([
      delta("thinking chunk", true),
      delta("visible chunk with <think> literal", false),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["thinking", "assistant"]);
    expect((items[0] as { text: string }).text).toBe("thinking chunk");
    expect((items[1] as { text: string }).text).toBe("visible chunk with <think> literal");
  });

  it("merges consecutive same-kind deltas into one item", () => {
    const items = play([delta("Hello "), delta("world")]);
    expect(items).toHaveLength(1);
    expect((items[0] as { text: string }).text).toBe("Hello world");
  });

  it("respects the is_thinking flag from Agno reasoning events", () => {
    const items = play([delta("native reasoning", true), delta("answer")]);
    expect(items.map((i) => i.kind)).toEqual(["thinking", "assistant"]);
  });

  it("BE already split reasoning: deltas arrive pre-classified", () => {
    // The BE routes thinking-mode chunks as is_thinking=true and
    // visible-mode chunks as is_thinking=false across one run; the
    // FE just appends to the right bubble by is_thinking.
    const items = play([
      delta("before tool", false),
      toolStarted,
      delta("post tool", false),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["assistant", "tool", "assistant"]);
  });

  it("updates the running tool card on completion", () => {
    const items = play([toolStarted, toolCompleted]);
    const tool = items[0] as Extract<ChatItem, { kind: "tool" }>;
    expect(tool.status).toBe("done");
    expect(tool.result).toBe("content");
  });

  it("marks failed tools as errors", () => {
    const items = play([
      toolStarted,
      { ...toolCompleted, is_error: true } as ServerMessage,
    ]);
    const tool = items[0] as Extract<ChatItem, { kind: "tool" }>;
    expect(tool.status).toBe("error");
  });

  it("shows a call rejected in the approval dialog as rejected, not done or failed", () => {
    const items = play([
      toolStarted,
      {
        ...toolCompleted,
        full_result: "Not run: the user rejected this call when asked to approve it.",
        is_rejected: true,
      } as ServerMessage,
    ]);
    const tool = items[0] as Extract<ChatItem, { kind: "tool" }>;
    expect(tool.status).toBe("rejected");
  });

  // ── tool_error event (separate from tool_completed{is_error}) ──
  // ``tool_error`` is the dedicated error event the BE emits when
  // a tool raises rather than returning a result. Walks back the
  // items list to find the most recent ``running`` tool card and
  // patches it with the error. If no running tool is found, falls
  // through to a standalone error item (defensive — tool_error
  // arriving with no prior tool_started shouldn't disappear).

  it("tool_error patches the running tool card with the error message", () => {
    const items = play([
      toolStarted,
      {
        type: "tool_error",
        error: "permission denied",
        run_id: "r1",
      } as ServerMessage,
    ]);
    expect(items).toHaveLength(1);
    const tool = items[0] as Extract<ChatItem, { kind: "tool" }>;
    expect(tool.kind).toBe("tool");
    expect(tool.status).toBe("error");
    expect(tool.result).toBe("permission denied");
    expect(tool.isError).toBe(true);
  });

  it("tool_error only patches a RUNNING tool (skips already-completed)", () => {
    // Defensive — if a stale tool_error arrives after the tool
    // completed normally, don't reopen the closed card. The
    // walk-back skips any non-running tool.
    const items = play([
      toolStarted,
      toolCompleted,
      {
        type: "tool_error",
        error: "ghost error",
        run_id: "r1",
      } as ServerMessage,
    ]);
    // The completed tool stays done; the error spawns a
    // standalone error item.
    const tool = items[0] as Extract<ChatItem, { kind: "tool" }>;
    expect(tool.status).toBe("done");
    // And the error landed as a separate item.
    expect(items.at(-1)?.kind).toBe("error");
  });

  it("tool_error with no prior tool_started spawns a standalone error item", () => {
    // The fallback at the end of the case branch — don't
    // silently drop the error.
    const items = play([
      {
        type: "tool_error",
        error: "out-of-band failure",
        run_id: "x",
      } as ServerMessage,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("error");
    expect((items[0] as { text: string }).text).toBe("out-of-band failure");
  });

  it("tool_error patches the MOST RECENT running tool (multiple cards)", () => {
    // Two concurrent tool cards both running. The error
    // should patch the most recent one (closest match
    // to whatever caused the error).
    const second: ServerMessage = {
      ...toolStarted,
      tool_name: "edit_file",
      friendly_name: "Edit",
      run_id: "r1",
    } as ServerMessage;
    const items = play([
      toolStarted,
      second,
      {
        type: "tool_error",
        error: "edit failed",
        run_id: "r1",
      } as ServerMessage,
    ]);
    const first = items[0] as Extract<ChatItem, { kind: "tool" }>;
    const last = items[1] as Extract<ChatItem, { kind: "tool" }>;
    // First tool still running.
    expect(first.status).toBe("running");
    // Second tool got the error.
    expect(last.status).toBe("error");
    expect(last.result).toBe("edit failed");
  });

  // ── run_error / error / info top-level events ─────────────

  it("run_error appends an error item", () => {
    const items = play([
      { type: "run_error", error: "model timed out" } as ServerMessage,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("error");
    expect((items[0] as { text: string }).text).toBe("model timed out");
  });

  it("error event appends an error item", () => {
    // The plain ``error`` event (vs ``run_error`` which carries
    // a run_id) — same shape, same handling.
    const items = play([
      { type: "error", text: "connection lost" } as ServerMessage,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("error");
    expect((items[0] as { text: string }).text).toBe("connection lost");
  });

  it("info event appends an info item", () => {
    // Info events surface BE-side notifications (e.g. "Artifacts
    // sync loaded 5 entries"). Distinct from error styling.
    const items = play([
      { type: "info", text: "artifacts sync complete" } as ServerMessage,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("info");
    expect((items[0] as { text: string }).text).toBe("artifacts sync complete");
  });

  it("unknown event types fall through (default branch — no-op)", () => {
    // Forward-compat — if the BE adds a new event type the FE
    // doesn't recognise, items pass through unchanged rather
    // than crashing.
    const items = play([
      delta("existing content"),
      { type: "some_future_event", payload: { x: 1 } } as unknown as ServerMessage,
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("assistant");
  });

  it("returns the same list for a message type it does not handle", () => {
    const items = play([delta("existing content")]);
    expect(play([{ type: "some_future_event" } as unknown as ServerMessage], items)).toBe(items);
    expect(
      play(
        [{ type: "model_completed", input_tokens: 1, output_tokens: 1, run_id: "r1", parent_run_id: null }],
        items,
      ),
    ).toBe(items);
  });

  it("returns the same list for an empty content_delta", () => {
    const items = play([delta("x")]);
    expect(play([delta("")], items)).toBe(items);
  });

  it("returns the same list when tool_completed finds no running tool", () => {
    const items = play([delta("x")]);
    expect(play([toolCompleted], items)).toBe(items);
  });

  it("marks a sub-agent run with an arrow and its name", () => {
    const items = play([
      { type: "run_started", agent_name: "researcher", run_id: "s1", parent_run_id: "r1", model: "m" },
    ]);
    expect(items).toMatchObject([{ kind: "agent", text: "→ researcher" }]);
  });

  it("drops the sub-agent marker while a streaming orchestrate card is last", () => {
    const card: ChatItem = { kind: "orchestrate", id: 1, cardId: "c", agents: {}, order: [], streaming: true };
    const items = [card];
    expect(
      play([{ type: "run_started", agent_name: "x", run_id: "s1", parent_run_id: "r1", model: "m" }], items),
    ).toBe(items);
  });

  it("stamps a top-level run's id on the newest untagged user message", () => {
    const user: UserItem = { kind: "user", id: 1, text: "hi" };
    const items = play(
      [{ type: "run_started", agent_name: "igni", run_id: "r9", parent_run_id: null, model: "m" }],
      [user],
    );
    expect(items[0]).toMatchObject({ kind: "user", runId: "r9" });
    expect(typeof (items[0] as UserItem).startedAt).toBe("number");
  });

  it("returns the same list when streaming_done matches no user message", () => {
    const items: ChatItem[] = [{ kind: "user", id: 1, text: "hi", runId: "other" }];
    expect(play([{ type: "streaming_done", run_id: "r1" }], items)).toBe(items);
  });
});

describe("run stats line", () => {
  const modelCompleted = (input: number, output: number): ServerMessage =>
    ({ type: "model_completed", input_tokens: input, output_tokens: output, run_id: "r1", parent_run_id: "" }) as ServerMessage;
  const runCompleted = (
    input: number,
    output: number,
    duration: number,
    parent = "",
    reasoning = 0,
  ): ServerMessage =>
    ({
      type: "run_completed",
      input_tokens: input,
      output_tokens: output,
      reasoning_tokens: reasoning,
      duration,
      run_id: "r1",
      parent_run_id: parent,
    }) as ServerMessage;

  // Stats items render via formatStats — exercise that path here so
  // the tests pin the visible string the chat shows.
  const statsItem = (item: ChatItem): StatsItem => {
    if (item.kind !== "stats") throw new Error("not a stats item: " + item.kind);
    return item;
  };
  const statsText = (item: ChatItem) => formatStats(statsItem(item));

  // 'out' / 'think' now count chars-of-rendered-text/4. Build helpers
  // that emit deltas of the right size so we can assert clean counts.
  const reply = (tokens: number) => delta("a".repeat(tokens * 4));      // visible
  const think = (tokens: number) => delta("a".repeat(tokens * 4), true); // reasoning
  const lastStats = (items: ChatItem[]) =>
    items.filter((i) => i.kind === "stats").at(-1) as ChatItem;

  it("does not render per-step model_completed badges", () => {
    expect(
      play([modelCompleted(14000, 90), modelCompleted(15000, 80)]).filter(
        (i) => i.kind === "stats",
      ),
    ).toHaveLength(0);
  });

  it("renders one roll-up line with duration on run_completed", () => {
    const items = play([reply(240), runCompleted(27400, 240, 12.4)]);
    expect(statsText(lastStats(items))).toBe("✦ 27.4k in · 240 out · 12.4s");
  });

  it("formats minute-scale durations and skips zero duration", () => {
    expect(
      statsText(lastStats(play([reply(1), runCompleted(1000, 1, 75)]))),
    ).toContain("1m 15s");
    expect(
      statsText(lastStats(play([reply(1), runCompleted(1000, 1, 0)]))),
    ).toBe("✦ 1.0k in · 1 out");
  });

  it("ignores sub-agent run_completed events", () => {
    expect(
      play([runCompleted(5000, 50, 3, "parent-run")]).filter(
        (i) => i.kind === "stats",
      ),
    ).toHaveLength(0);
  });

  it("splits visible thinking and visible reply into separate segments", () => {
    // Reasoning model: 280 tokens of thinking, 50 tokens of visible
    // reply. Agno billed it as 330 output total (280 reasoning) — we
    // don't read those for display; we count what we rendered.
    const items = play([think(280), reply(50), runCompleted(22000, 330, 16, "", 280)]);
    expect(statsText(lastStats(items))).toBe("✦ 22.0k in · 280 think · 50 out · 16.0s");
  });

  it("correctStats replaces input with count_context_tokens", () => {
    const items = play([think(280), reply(50), runCompleted(22000, 330, 16, "", 280)]);
    const fixed = transcript(items).correctStats("r1", 13900).items;
    expect(statsText(lastStats(fixed))).toBe(
      "✦ 13.9k in · 280 think · 50 out · 16.0s",
    );
    // Other stats items (different runId) shouldn't move.
    const otherRun = transcript(items).correctStats("r2", 9999).items;
    expect(statsText(lastStats(otherRun))).toBe(
      "✦ 22.0k in · 280 think · 50 out · 16.0s",
    );
  });

  it("lands the stats line just before the next user turn", () => {
    const items = play([
      { type: "run_started", agent_name: "igni", run_id: "r1", parent_run_id: null, model: "m" },
    ], [{ kind: "user", id: 100, text: "first" }]);
    const withReply = play([reply(10)], items);
    const withNext: ChatItem[] = [...withReply, { kind: "user", id: 101, text: "second" }];
    const done = play([runCompleted(1000, 10, 1)], withNext);
    expect(done.map((i) => i.kind)).toEqual(["user", "assistant", "stats", "user"]);
  });

  it("settles the turn's streaming orchestrate card on run_completed", () => {
    const card: ChatItem = { kind: "orchestrate", id: 1, cardId: "c", agents: {}, order: [], streaming: true };
    const items = play([runCompleted(0, 0, 1)], [card]);
    expect(items[0]).toMatchObject({ kind: "orchestrate", streaming: false });
  });

  it("returns the same list for a sub-agent run_completed", () => {
    const items = play([reply(1)]);
    expect(play([runCompleted(5000, 50, 3, "parent-run")], items)).toBe(items);
  });
});
