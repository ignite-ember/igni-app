import { beforeEach, describe, expect, it } from "vitest";
import { parseWorkflowEvent, type WorkflowEvent } from "../protocol/workflowEvents";
import type { ChatItem } from "./chatItem";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { ChatTranscript } from "./chatTranscript";
import { WorkflowRunModel } from "./workflowRun";

let factory: ChatItemFactory;
beforeEach(() => {
  factory = new ChatItemFactory(new ChatItemIds());
});

function fold(items: ChatItem[], ev: WorkflowEvent): ChatItem[] {
  return new ChatTranscript(items, factory).applyWorkflowEvent(ev).items;
}

function wfEvent(
  type: string,
  payload: Record<string, unknown>,
  seq = 0,
  runId = "wf_test",
): WorkflowEvent {
  const ev = parseWorkflowEvent({
    workflow_run_id: runId,
    name: "smoke",
    ts: 1_700_000_000_000 + seq,
    seq,
    type,
    payload,
  });
  if (!ev) throw new Error("not a workflow event");
  return ev;
}

describe("ChatItemFactory#workflow", () => {
  it("creates a fresh running card", () => {
    const item = factory.workflow("smoke", "wf_abc");
    expect(item.kind).toBe("workflow");
    if (item.kind !== "workflow") return;
    expect(item.run.name).toBe("smoke");
    expect(item.run.workflowRunId).toBe("wf_abc");
    expect(item.run.status).toBe("running");
    expect(item.run.phases).toEqual([]);
    expect(item.run.events).toEqual([]);
  });
});

describe("ChatTranscript#applyWorkflowEvent", () => {
  it("creates a card on the first event for an unknown id", () => {
    const events: WorkflowEvent[] = [
      wfEvent("workflow_started", { name: "smoke" }, 0),
    ];
    const items = fold([], events[0]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("workflow");
    if (items[0].kind !== "workflow") return;
    expect(items[0].run.name).toBe("smoke");
    expect(items[0].run.status).toBe("running");
  });

  it("appends a phase_started into the typed structure", () => {
    let items = fold([], wfEvent("workflow_started", {}, 0));
    items = fold(
      items,
      wfEvent("phase_started", { phase_id: "p1", title: "Assess" }, 1),
    );
    if (items[0].kind !== "workflow") return;
    expect(items[0].run.phases).toHaveLength(1);
    expect(items[0].run.phases[0].title).toBe("Assess");
    expect(items[0].run.phases[0].status).toBe("running");
  });

  it("completes the phase on phase_completed and appends the next", () => {
    let items: ChatItem[] = [];
    items = fold(items, wfEvent("workflow_started", {}, 0));
    items = fold(
      items,
      wfEvent("phase_started", { phase_id: "p1", title: "A" }, 1),
    );
    items = fold(
      items,
      wfEvent("phase_completed", { phase_id: "p1", status: "completed" }, 2),
    );
    items = fold(
      items,
      wfEvent("phase_started", { phase_id: "p2", title: "B" }, 3),
    );
    if (items[0].kind !== "workflow") return;
    expect(items[0].run.phases).toHaveLength(2);
    expect(items[0].run.phases[0].status).toBe("completed");
    expect(items[0].run.phases[1].status).toBe("running");
  });

  it("appends an agent under the current running phase", () => {
    let items: ChatItem[] = [];
    items = fold(items, wfEvent("workflow_started", {}, 0));
    items = fold(
      items,
      wfEvent("phase_started", { phase_id: "p1", title: "P" }, 1),
    );
    items = fold(
      items,
      wfEvent(
        "agent_started",
        { id: "req_1", label: "audit" },
        2,
      ),
    );
    if (items[0].kind !== "workflow") return;
    expect(items[0].run.phases[0].agents).toHaveLength(1);
    expect(items[0].run.phases[0].agents[0].label).toBe("audit");
    expect(items[0].run.phases[0].agents[0].status).toBe("running");
  });

  it("flips status to completed on workflow_completed", () => {
    let items: ChatItem[] = [];
    items = fold(items, wfEvent("workflow_started", {}, 0));
    items = fold(
      items,
      wfEvent(
        "workflow_completed",
        { status: "completed", result: { ok: true } },
        1,
      ),
    );
    if (items[0].kind !== "workflow") return;
    expect(items[0].run.status).toBe("completed");
    expect(items[0].run.result).toEqual({ ok: true });
  });

  it("preserves the raw event tape on every run.events", () => {
    let items: ChatItem[] = [];
    const evs = [
      wfEvent("workflow_started", {}, 0),
      wfEvent("phase_started", { phase_id: "p1", title: "A" }, 1),
      wfEvent("phase_completed", { phase_id: "p1" }, 2),
      wfEvent("workflow_completed", { status: "completed" }, 3),
    ];
    for (const ev of evs) items = fold(items, ev);
    if (items[0].kind !== "workflow") return;
    expect(items[0].run.events).toHaveLength(4);
  });
});

describe("WorkflowRunModel.fromEvents", () => {
  it("rebuilds phase structure from a sequence of persisted events", () => {
    const events: WorkflowEvent[] = [
      wfEvent("workflow_started", {}, 0),
      wfEvent("phase_started", { phase_id: "p1", title: "Assess" }, 1),
      wfEvent("phase_completed", { phase_id: "p1", status: "completed" }, 2),
      wfEvent("phase_started", { phase_id: "p2", title: "Design" }, 3),
      wfEvent("workflow_completed", { status: "completed", result: { ok: true } }, 4),
    ];
    const run = WorkflowRunModel.fromEvents(events)?.state ?? null;
    expect(run).not.toBeNull();
    if (!run) return;
    expect(run.phases).toHaveLength(2);
    expect(run.phases[0].title).toBe("Assess");
    expect(run.phases[0].status).toBe("completed");
    expect(run.phases[1].title).toBe("Design");
    expect(run.phases[1].status).toBe("running");
    expect(run.status).toBe("completed");
    expect(run.result).toEqual({ ok: true });
  });

  it("returns null for an empty event list", () => {
    expect(WorkflowRunModel.fromEvents([])).toBeNull();
  });

  it("keeps a cancelled workflow_completed cancelled", () => {
    const run = WorkflowRunModel.fromEvents([
      wfEvent("workflow_started", {}, 0),
      wfEvent("workflow_completed", { status: "cancelled" }, 1),
    ]);
    expect(run?.state.status).toBe("cancelled");
  });

  it("keeps a failed run failed, with its error", () => {
    const run = WorkflowRunModel.fromEvents([
      wfEvent("workflow_started", {}, 0),
      wfEvent("workflow_failed", { error: "boom" }, 1),
      wfEvent("workflow_completed", { status: "failed" }, 2),
    ]);
    expect(run?.state.status).toBe("failed");
    expect(run?.state.error).toBe("boom");
  });

  it("restores agents and their parallel groups", () => {
    const run = WorkflowRunModel.fromEvents([
      wfEvent("workflow_started", { args: { file: "a.py" } }, 0),
      wfEvent("phase_started", { phase_id: "p1", title: "P" }, 1),
      wfEvent("parallel_started", { group_id: "g" }, 2),
      wfEvent("agent_started", { id: "a1", label: "x" }, 3),
      wfEvent("parallel_completed", { group_id: "g" }, 4),
    ]);
    expect(run?.state.args).toEqual({ file: "a.py" });
    expect(run?.state.phases[0].agents).toMatchObject([{ agentId: "a1", parallelGroupId: "g" }]);
    expect(run?.state.activeParallelGroupId).toBeUndefined();
  });

  it("starts the run at the first event's timestamp", () => {
    const run = WorkflowRunModel.fromEvents([wfEvent("workflow_started", {}, 0)]);
    expect(run?.state.startedAtMs).toBe(1_700_000_000_000);
  });
});

describe("WorkflowRunModel#apply — parallel grouping", () => {
  it("tags agents with the active parallel group_id during a parallel() block", () => {
    let items: ChatItem[] = [];
    items = fold(items, wfEvent("workflow_started", {}, 0));
    items = fold(
      items,
      wfEvent("phase_started", { phase_id: "p1", title: "Design" }, 1),
    );
    items = fold(
      items,
      wfEvent("parallel_started", { group_id: "par_x", lane_count: 3 }, 2),
    );
    items = fold(
      items,
      wfEvent("agent_started", { id: "a1", label: "design:minimal" }, 3),
    );
    items = fold(
      items,
      wfEvent("agent_started", { id: "a2", label: "design:arch" }, 4),
    );
    items = fold(
      items,
      wfEvent("agent_started", { id: "a3", label: "design:cons" }, 5),
    );
    items = fold(
      items,
      wfEvent("parallel_completed", { group_id: "par_x" }, 6),
    );
    // Serial agent after the parallel block.
    items = fold(
      items,
      wfEvent("agent_started", { id: "a4", label: "judge" }, 7),
    );
    if (items[0].kind !== "workflow") return;
    const agents = items[0].run.phases[0].agents;
    expect(agents).toHaveLength(4);
    expect(agents[0].parallelGroupId).toBe("par_x");
    expect(agents[1].parallelGroupId).toBe("par_x");
    expect(agents[2].parallelGroupId).toBe("par_x");
    // Serial agent after the parallel block has no group.
    expect(agents[3].parallelGroupId).toBeUndefined();
  });
});

describe("WorkflowRunModel#apply — serial + parallel mixed", () => {
  it("labels the right groups when serial and parallel interleave", () => {
    let items: ChatItem[] = [];
    items = fold(
      items,
      wfEvent("workflow_started", {}, 0),
    );
    items = fold(
      items,
      wfEvent("phase_started", { phase_id: "p1", title: "Design" }, 1),
    );
    // Serial agent first.
    items = fold(
      items,
      wfEvent("agent_started", { id: "a0", label: "intro" }, 2),
    );
    items = fold(
      items,
      wfEvent("agent_completed", { id: "a0", status: "completed" }, 3),
    );
    // Parallel block of two.
    items = fold(
      items,
      wfEvent("parallel_started", { group_id: "g1", lane_count: 2 }, 4),
    );
    items = fold(
      items,
      wfEvent("agent_started", { id: "a1", label: "d-1" }, 5),
    );
    items = fold(
      items,
      wfEvent("agent_started", { id: "a2", label: "d-2" }, 6),
    );
    items = fold(
      items,
      wfEvent("parallel_completed", { group_id: "g1" }, 7),
    );
    // Another parallel block of two.
    items = fold(
      items,
      wfEvent("parallel_started", { group_id: "g2", lane_count: 2 }, 8),
    );
    items = fold(
      items,
      wfEvent("agent_started", { id: "a3", label: "r-1" }, 9),
    );
    items = fold(
      items,
      wfEvent("agent_started", { id: "a4", label: "r-2" }, 10),
    );
    items = fold(
      items,
      wfEvent("parallel_completed", { group_id: "g2" }, 11),
    );
    // Trailing serial agent.
    items = fold(
      items,
      wfEvent("agent_started", { id: "a5", label: "synthesize" }, 12),
    );
    if (items[0].kind !== "workflow") return;
    const agents = items[0].run.phases[0].agents;
    expect(agents).toHaveLength(6);
    expect(agents[0].parallelGroupId).toBeUndefined();
    expect(agents[1].parallelGroupId).toBe("g1");
    expect(agents[2].parallelGroupId).toBe("g1");
    expect(agents[3].parallelGroupId).toBe("g2");
    expect(agents[4].parallelGroupId).toBe("g2");
    expect(agents[5].parallelGroupId).toBeUndefined();
  });
});


describe("WorkflowRunModel#apply — failure tape", () => {
  it("treats workflow_completed{status: 'failed'} as a failed run", () => {
    let items: ChatItem[] = [];
    items = fold(
      items,
      wfEvent("workflow_started", {}, 0),
    );
    items = fold(
      items,
      wfEvent("phase_started", { phase_id: "p1", title: "Design" }, 1),
    );
    items = fold(
      items,
      wfEvent("agent_started", { id: "a1", label: "design" }, 2),
    );
    items = fold(
      items,
      wfEvent("agent_completed", {
        id: "a1", label: "design", status: "failed",
        error: "boom",
      }, 3),
    );
    items = fold(
      items,
      wfEvent("phase_completed", { phase_id: "p1", status: "failed" }, 4),
    );
    items = fold(
      items,
      wfEvent("workflow_failed", { error: "Design phase failed" }, 5),
    );
    items = fold(
      items,
      wfEvent("workflow_completed", {
        status: "failed",
        result: { status: "needs-attention" },
      }, 6),
    );
    if (items[0].kind !== "workflow") return;
    expect(items[0].run.status).toBe("failed");
    expect(items[0].run.error).toBe("Design phase failed");
  });
});


describe("WorkflowRunModel#apply — unrecognized events", () => {
  it("tapes them without touching the typed state", () => {
    const run = WorkflowRunModel.start("smoke", "wf_test", 0);
    const next = run.apply(wfEvent("log", { text: "hello" }, 1));
    expect(next.state.events).toHaveLength(1);
    expect(next.state.events[0]).toMatchObject({ type: "unrecognized", wireType: "log" });
    expect({ ...next.state, events: [] }).toEqual(run.state);
  });
});
