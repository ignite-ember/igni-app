import { beforeEach, describe, expect, it } from "vitest";
import type { OrchestrateEventEnvelope } from "../protocol/orchestrateEvents";
import { parseWorkflowEvent, type WorkflowEvent } from "../protocol/workflowEvents";
import type { AssistantInterrupted, ChatItem, OrchestrateItem, WorkflowItem } from "./chatItem";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { ChatTranscript } from "./chatTranscript";
import { WorkflowRunModel } from "./workflowRun";

let factory: ChatItemFactory;
beforeEach(() => {
  factory = new ChatItemFactory(new ChatItemIds());
});

const t = (items: ChatItem[]) => new ChatTranscript(items, factory);

// ── correctStats ─────────────────────────────────────────
//
// Post-stream correction of the stats line's ``in`` token
// count. The live count from the streaming-event totals can
// undercount (model providers exclude the cached portion of
// the context); the BE fires a ``count_context_tokens`` RPC
// after the run completes and we patch the stats item with
// the authoritative number, marking ``corrected: true`` so
// the badge renders a check mark.

describe("ChatTranscript#correctStats", () => {
  const stats = {
    kind: "stats" as const,
    id: 1,
    runId: "run-a",
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 0,
    visibleThinkTokens: 0,
    visibleOutTokens: 25,
    duration: 1.5,
    corrected: false,
  };

  it("updates matching runId's stats with the new count and corrected flag", () => {
    const out = t([stats]).correctStats("run-a", 250).items;
    expect(out[0]).toMatchObject({
      kind: "stats",
      inputTokens: 250,
      corrected: true,
    });
  });

  it("leaves non-stats items untouched", () => {
    // Only ``stats`` items get patched; user/assistant/tool
    // items pass through identity-equal.
    const user = { kind: "user" as const, id: 2, text: "hi" };
    const out = t([user, stats]).correctStats("run-a", 250).items;
    expect(out[0]).toBe(user); // same reference
    expect(out[1]).not.toBe(stats); // new object for stats
  });

  it("leaves stats items with mismatched runId untouched", () => {
    const out = t([stats]).correctStats("different-run", 999).items;
    expect(out[0]).toBe(stats); // same reference, no mutation
  });

  it("patches all matching items (e.g. multiple stats for same run)", () => {
    // Edge case — if there are two stats items for the same
    // run somehow (BE bug, replay race), both get the same
    // correction.
    const stats2 = { ...stats, id: 3 };
    const out = t([stats, stats2]).correctStats("run-a", 250).items;
    expect((out[0] as typeof stats).inputTokens).toBe(250);
    expect((out[1] as typeof stats).inputTokens).toBe(250);
  });

  it("does not mutate the input items in place", () => {
    // The reducer must be pure — mutating in place would
    // break React's identity-equality-based memoisation.
    t([stats]).correctStats("run-a", 250).items;
    expect(stats.inputTokens).toBe(100); // unchanged
    expect(stats.corrected).toBe(false); // unchanged
  });
});

// ── markRunPersisted ───────────────────────────────────
//
// Stamps ``persisted: true`` on the user item owning a given
// runId. Called from App.tsx's ``run_completed`` handler — the
// BE has just confirmed it persisted the run, so a subsequent
// edit/delete can call ``truncate_history`` instead of falling
// back to a local-only trim. Mirrors the walk-backward pattern
// used by the ``run_started`` backfill so an out-of-order event
// still finds the right item.

describe("ChatTranscript#markRunPersisted", () => {
  const user = (
    id: number,
    text: string,
    runId?: string,
    persisted?: boolean,
  ): ChatItem => ({
    kind: "user",
    id,
    text,
    runId,
    persisted,
  });

  it("stamps persisted: true on the matching user item", () => {
    const items: ChatItem[] = [user(1, "hello", "run-a")];
    const out = t(items).markRunPersisted("run-a").items;
    expect(out[0]).toMatchObject({ kind: "user", persisted: true });
  });

  it("leaves already-persisted items alone (idempotent)", () => {
    // ``run_completed`` could fire twice (BE retry / duplicate
    // event). The guard prevents a fresh object every time, which
    // would invalidate React.memo on the item row.
    const items: ChatItem[] = [user(1, "hello", "run-a", true)];
    const out = t(items).markRunPersisted("run-a").items;
    expect(out[0]).toBe(items[0]);
  });

  it("walks backward and stamps the most recent matching user", () => {
    // Multiple user items; the run_completed event corresponds to
    // the LAST one. Earlier ones keep their prior persisted state.
    const items: ChatItem[] = [
      user(1, "first", "run-x", true),
      user(2, "second", "run-a"),
    ];
    const out = t(items).markRunPersisted("run-a").items;
    expect((out[0] as Extract<ChatItem, { kind: "user" }>).persisted).toBe(true);
    expect((out[1] as Extract<ChatItem, { kind: "user" }>).persisted).toBe(true);
    // First item must still be the same reference (not a re-stamp).
    expect(out[0]).toBe(items[0]);
  });

  it("stops walking at an earlier user item with a different runId", () => {
    // Mirror of the run_started backfill: once we hit an earlier
    // user (any runId), stop. Otherwise an event for run-a could
    // accidentally stamp run-b's user if it was somehow first.
    const items: ChatItem[] = [
      user(1, "earlier", "run-b"),
      user(2, "current", "run-a"),
    ];
    const out = t(items).markRunPersisted("run-a").items;
    expect((out[1] as Extract<ChatItem, { kind: "user" }>).persisted).toBe(true);
    expect((out[0] as Extract<ChatItem, { kind: "user" }>).persisted).toBeUndefined();
  });

  it("returns the input unchanged when no user matches the runId", () => {
    const items: ChatItem[] = [user(1, "hello", "run-other")];
    const out = t(items).markRunPersisted("run-a").items;
    expect(out).toBe(items);
  });

  it("does not mutate the input items in place", () => {
    const items: ChatItem[] = [user(1, "hello", "run-a")];
    t(items).markRunPersisted("run-a").items;
    expect((items[0] as Extract<ChatItem, { kind: "user" }>).persisted).toBeUndefined();
  });
});


// ── markInterrupted ───────────────────────────────
//
// Stamps ``interrupted: reason`` on the trailing assistant bubble
// so the Retry / Discard / Edit-prompt banner renders (see
// ``chatItems/InterruptedBanner.tsx``). Called from the
// cancel + error paths in App.tsx.

describe("ChatTranscript#markInterrupted", () => {
  const user = (id: number): ChatItem => ({ kind: "user", id, text: "hi" });
  const assistant = (id: number, text: string): ChatItem => ({
    kind: "assistant",
    id,
    text,
  });
  const tool = (id: number): ChatItem => ({
    kind: "tool",
    id,
    runId: "r1",
    name: "x",
    args: "{}",
    status: "done",
    result: "",
    isError: false,
    diffRows: null,
  });

  it("stamps the trailing assistant item with the reason", () => {
    const items: ChatItem[] = [user(1), assistant(2, "partial answer")];
    const out = t(items).markInterrupted("cancelled").items;
    expect(out[1]).toMatchObject({ kind: "assistant", interrupted: "cancelled" });
    expect(out[1]).not.toBe(items[1]); // new object, not mutation
    expect(items[1]).not.toHaveProperty("interrupted"); // original untouched
  });

  it("walks past tool / thinking / agent items to find the assistant", () => {
    // Stream ended on a tool call before any assistant text landed
    // (rare but happens on tool-error early in the run). The
    // banner should still appear on the assistant bubble above
    // the tool, not float above an unrelated bubble.
    const items: ChatItem[] = [
      user(1),
      assistant(2, "thinking…"),
      tool(3),
    ];
    const out = t(items).markInterrupted("errored").items;
    expect(out[1]).toMatchObject({ kind: "assistant", interrupted: "errored" });
    expect(out[2]).toBe(items[2]); // tool untouched
  });

  it("stops walking when it hits the preceding user item", () => {
    // No assistant after the user — run was cancelled before any
    // text streamed. Returns the list unchanged; the FE can still
    // surface the interrupted user message via its own banner
    // (or just leave it; the spinner cleared via setRunPhase).
    const items: ChatItem[] = [user(1), tool(2)];
    const out = t(items).markInterrupted("cancelled").items;
    expect(out).toBe(items);
  });

  it("is idempotent on the same reason", () => {
    // Re-running with the same reason returns the SAME array
    // reference so React's referential-equality check skips a
    // re-render. Different reason still updates the bubble.
    const items: ChatItem[] = [user(1), assistant(2, "p")];
    const once = t(items).markInterrupted("cancelled").items;
    const twice = t(once).markInterrupted("cancelled").items;
    expect(twice).toBe(once);
    const escalated = t(once).markInterrupted("errored").items;
    expect(escalated).not.toBe(once);
    expect(escalated[1]).toMatchObject({ interrupted: "errored" });
  });

  it("preserves the original assistant text on the stamped item", () => {
    // The banner should NOT clobber the partial response — the
    // user wants to see what was streamed so they can decide
    // between retry / discard / edit-prompt.
    const items: ChatItem[] = [
      user(1),
      assistant(2, "I was about to say that the answer is 42 because…"),
    ];
    const out = t(items).markInterrupted("abandoned").items;
    expect(out[1]).toMatchObject({
      kind: "assistant",
      text: "I was about to say that the answer is 42 because…",
      interrupted: "abandoned",
    });
  });

  it("accepts every AssistantInterrupted variant", () => {
    const variants: AssistantInterrupted[] = ["cancelled", "errored", "abandoned"];
    for (const v of variants) {
      const items: ChatItem[] = [user(1), assistant(2, "p")];
      const out = t(items).markInterrupted(v).items;
      expect(out[1]).toMatchObject({ interrupted: v });
    }
  });
});

// ── precedingUserOf ─────────────────────────────────
//
// Used by the banner's Retry / Discard / Edit-prompt actions to
// find the user message that triggered the interrupted run.
// All three need to act on that user item (truncate, re-fire, or
// seed the composer).

describe("ChatTranscript#precedingUserOf", () => {
  const user = (id: number, text = "hi"): ChatItem => ({
    kind: "user",
    id,
    text,
  });
  const assistant = (id: number, text = "a"): ChatItem => ({
    kind: "assistant",
    id,
    text,
  });

  it("finds the user item immediately preceding the given assistant", () => {
    const items: ChatItem[] = [
      user(1, "first"),
      assistant(2, "first reply"),
      user(3, "second"),
      assistant(4, "partial…"),
    ];
    expect(t(items).precedingUserOf(4)).toMatchObject({
      kind: "user",
      id: 3,
      text: "second",
    });
  });

  it("returns undefined when the assistant has no preceding user", () => {
    // Edge case: assistant at the head of the items list, with no
    // user message before it. Shouldn't happen in practice (the
    // user always precedes the assistant), but the undefined-return
    // lets the caller bail gracefully.
    const items: ChatItem[] = [assistant(1, "orphan")];
    expect(t(items).precedingUserOf(1)).toBeUndefined();
  });

  it("returns undefined when the assistant id is not in the list", () => {
    const items: ChatItem[] = [user(1, "hi"), assistant(2, "reply")];
    expect(t(items).precedingUserOf(999)).toBeUndefined();
  });

  it("ignores items after the target assistant", () => {
    // Walks from the end — items appended after the target (e.g.
    // a tool call fired after the cancelled assistant text) must
    // not be considered as "preceding" the assistant.
    const items: ChatItem[] = [
      user(1, "ask"),
      assistant(2, "partial"),
      user(3, "follow-up typed while streaming"),
    ];
    expect(t(items).precedingUserOf(2)).toMatchObject({ id: 1, text: "ask" });
  });
});


describe("ChatTranscript returns itself when nothing changed", () => {
  it("markRunPersisted with no matching user", () => {
    const tr = t([{ kind: "user", id: 1, text: "hi", runId: "other" }]);
    expect(tr.markRunPersisted("run-a")).toBe(tr);
  });

  it("markInterrupted with the same reason", () => {
    const tr = t([{ kind: "user", id: 1, text: "hi" }, { kind: "assistant", id: 2, text: "p", interrupted: "cancelled" }]);
    expect(tr.markInterrupted("cancelled")).toBe(tr);
  });

  it("correctStats with no matching stats", () => {
    const tr = t([{ kind: "user", id: 1, text: "hi" }]);
    expect(tr.correctStats("run-a", 5)).toBe(tr);
  });

  it("appendText with empty text", () => {
    const tr = t([]);
    expect(tr.appendText("", false)).toBe(tr);
  });
});

// ── applyOrchestrateEvent ─────────────────────────────────

describe("ChatTranscript#applyOrchestrateEvent", () => {
  const started = (cardId: string, path: string): OrchestrateEventEnvelope => ({
    cardId,
    event: { type: "agent_started", agent_path: path, agent: path, parent: null },
  });
  const completed = (cardId: string, path: string): OrchestrateEventEnvelope => ({
    cardId,
    event: { type: "agent_completed", agent_path: path, is_error: false },
  });
  const preview = (cardId: string, text: string): OrchestrateEventEnvelope => ({
    cardId,
    event: { type: "content_preview", agent_path: "root", text },
  });
  const cards = (items: ChatItem[]) =>
    items.filter((it): it is OrchestrateItem => it.kind === "orchestrate");

  it("opens a card for an unseen card id, with a factory id", () => {
    factory.info("before");
    const out = t([]).applyOrchestrateEvent(started("c1", "qa")).items;
    expect(cards(out)).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "orchestrate", id: 2, cardId: "c1", order: ["qa"], streaming: true });
  });

  it("routes by card id, past interleaved items", () => {
    let tr = t([]).applyOrchestrateEvent(started("c1", "qa"));
    tr = tr.append(factory.info("interleaved"));
    tr = tr.applyOrchestrateEvent(started("c1", "sec"));
    expect(cards(tr.items)).toHaveLength(1);
    expect(cards(tr.items)[0].order).toEqual(["qa", "sec"]);
  });

  it("opens a second card for a second card id", () => {
    const tr = t([]).applyOrchestrateEvent(started("c1", "qa")).applyOrchestrateEvent(started("c2", "qa"));
    expect(cards(tr.items).map((c) => c.cardId)).toEqual(["c1", "c2"]);
  });

  it("folds an event without a card id into the last active card", () => {
    const tr = t([])
      .applyOrchestrateEvent(started("c1", "qa"))
      .applyOrchestrateEvent(preview("", "legacy line"));
    expect(cards(tr.items)).toHaveLength(1);
    expect(cards(tr.items)[0].agents.root.previewLines).toEqual(["legacy line"]);
  });

  it("opens a card with an empty id when no active card takes a card-less event", () => {
    const tr = t([])
      .applyOrchestrateEvent(started("c1", "qa"))
      .applyOrchestrateEvent(completed("c1", "qa"))
      .applyOrchestrateEvent(preview("", "legacy line"));
    expect(cards(tr.items).map((c) => c.cardId)).toEqual(["c1", ""]);
  });

  it("returns the same transcript when the event changes nothing", () => {
    const tr = t([]).applyOrchestrateEvent(started("c1", "qa")).applyOrchestrateEvent(preview("c1", "x"));
    expect(tr.applyOrchestrateEvent(preview("c1", "x"))).toBe(tr);
  });

  it("a card opened before /clear does not survive its id boundary", () => {
    // Regression: cards took ``Date.now()`` as their id, which is
    // always above the allocator's boundary, so /clear kept them.
    const tr = t([factory.user("hi")]).applyOrchestrateEvent(started("c1", "qa"));
    const boundary = factory.ids.last();
    const later = factory.info("typed while /clear ran");
    const kept = [...tr.items, later].filter((it) => it.id > boundary);
    expect(kept).toEqual([later]);
  });
});

// ── applyWorkflowEvent ────────────────────────────────────

describe("ChatTranscript#applyWorkflowEvent", () => {
  const ev = (type: string, payload: Record<string, unknown>, seq: number): WorkflowEvent => {
    const parsed = parseWorkflowEvent({ workflow_run_id: "wf_1", name: "smoke", ts: 1000 + seq, seq, type, payload });
    if (!parsed) throw new Error("bad event");
    return parsed;
  };

  it("opens a card on a miss with the same tape and state as start().apply()", () => {
    const first = ev("phase_started", { phase_id: "p1", title: "A" }, 0);
    const out = t([]).applyWorkflowEvent(first).items;
    expect(out).toHaveLength(1);
    const card = out[0] as WorkflowItem;
    expect(card.run).toEqual(WorkflowRunModel.start("smoke", "wf_1", 1000).apply(first).state);
    expect(card.run.events).toEqual([first]);
  });

  it("folds into the existing card in place", () => {
    const optimistic = factory.workflow("smoke", "wf_1", 5);
    const out = t([optimistic]).applyWorkflowEvent(ev("phase_started", { phase_id: "p1" }, 0)).items;
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(optimistic.id);
    expect((out[0] as WorkflowItem).run.phases[0].title).toBe("(unnamed phase)");
  });
});

describe("ChatTranscript#assistantTextForStats", () => {
  const stats = () =>
    factory.stats({
      runId: "r",
      inputTokens: 1,
      outputTokens: 1,
      reasoningTokens: 0,
      visibleThinkTokens: 0,
      visibleOutTokens: 0,
      duration: 1,
      corrected: true,
    });

  it("finds the assistant text that closes the stats line's turn", () => {
    const items = [factory.user("q"), factory.assistant("answer"), factory.thinking("t"), stats()];
    expect(t(items).assistantTextForStats(3)).toBe("answer");
  });

  it("stops at the turn's user message", () => {
    const items = [factory.assistant("old"), factory.user("q"), stats()];
    expect(t(items).assistantTextForStats(2)).toBeUndefined();
  });

  it("has nothing for an index that is not a stats line", () => {
    const items = [factory.assistant("a")];
    expect(t(items).assistantTextForStats(0)).toBeUndefined();
    expect(t(items).assistantTextForStats(5)).toBeUndefined();
  });
});

describe("ChatTranscript#startWorkflow", () => {
  it("opens the run's card", () => {
    const next = t([]).startWorkflow("build", "wf1");
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ kind: "workflow", run: { workflowRunId: "wf1" } });
  });

  it("leaves a card its first event already opened", () => {
    const opened = t([]).startWorkflow("build", "wf1");
    expect(opened.startWorkflow("build", "wf1")).toBe(opened);
  });
});
