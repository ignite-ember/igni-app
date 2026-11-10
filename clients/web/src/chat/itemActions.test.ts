import { afterEach, describe, expect, it, vi } from "vitest";

import { RunWorkflowResult } from "../protocol/rpcResults";
import type { PlanItem, WorkflowItem } from "./chatItem";
import { ItemActions } from "./itemActions";
import { ArrayTranscript } from "./transcriptView.test.util";

function setup(opts: { start?: () => Promise<RunWorkflowResult>; approve?: () => Promise<unknown> } = {}) {
  const t = new ArrayTranscript();
  const client = {
    rpc: vi.fn(async (): Promise<unknown> => undefined),
    calls: {
      approvePlan: vi.fn(opts.approve ?? (async () => undefined)),
      dismissPlan: vi.fn(async () => undefined),
    },
  };
  const streamer = { send: vi.fn(async () => {}) };
  const workflows = { start: vi.fn(opts.start ?? (async () => new RunWorkflowResult("wf_real", "build"))) };
  const actions = new ItemActions({ client: client as never, view: t.view, streamer, workflows });
  return { t, client, streamer, workflows, actions };
}

function planCard(t: ArrayTranscript, runId: string): PlanItem {
  const card = t.chatItems.plan({ plan: "do it", runId });
  t.items = [...t.items, card];
  return card;
}

const workflowCards = (t: ArrayTranscript) =>
  t.items.filter((it): it is WorkflowItem => it.kind === "workflow");

afterEach(() => vi.restoreAllMocks());

describe("ItemActions#rerunWorkflow", () => {
  it("starts the run with its args and opens the card under the run id the backend answered", async () => {
    const s = setup();
    s.actions.rerunWorkflow({ name: "build", args: { target: "web" } });
    // Nothing is shown before the backend names the run: a made-up id
    // would never receive the run's events.
    expect(workflowCards(s.t)).toHaveLength(0);
    await vi.waitFor(() => expect(workflowCards(s.t)).toHaveLength(1));
    expect(s.workflows.start).toHaveBeenCalledWith("build", { target: "web" });
    expect(workflowCards(s.t)[0].run).toMatchObject({ workflowRunId: "wf_real", name: "build" });
  });

  it("starts a run that kept no args with none", async () => {
    const s = setup();
    s.actions.rerunWorkflow({ name: "build" });
    await vi.waitFor(() => expect(workflowCards(s.t)).toHaveLength(1));
    expect(s.workflows.start).toHaveBeenCalledWith("build", {});
  });

  it("does not open a second card when the run's first event already did", async () => {
    let answer: (r: RunWorkflowResult) => void = () => {};
    const s = setup({ start: () => new Promise((resolve) => (answer = resolve)) });
    s.actions.rerunWorkflow({ name: "build" });
    s.t.items = [...s.t.items, s.t.chatItems.workflow("build", "wf_real")];
    answer(new RunWorkflowResult("wf_real", "build"));
    await Promise.resolve();
    await Promise.resolve();
    expect(workflowCards(s.t)).toHaveLength(1);
  });

  it("opens no card when the backend refuses the run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ start: async () => Promise.reject(new Error("no such workflow")) });
    s.actions.rerunWorkflow({ name: "gone" });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(workflowCards(s.t)).toHaveLength(0);
  });
});

describe("ItemActions plan cards", () => {
  it("approves by the card's run id, then wakes the agent", async () => {
    const s = setup();
    const card = planCard(s.t, "run-7");
    s.actions.approvePlan(card.id);
    await vi.waitFor(() => expect(s.streamer.send).toHaveBeenCalledWith("Plan approved — execute it now."));
    expect(s.client.calls.approvePlan).toHaveBeenCalledWith("run-7");
  });

  it("still wakes the agent when persisting the approval fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ approve: async () => Promise.reject(new Error("offline")) });
    const card = planCard(s.t, "run-7");
    s.actions.approvePlan(card.id);
    await vi.waitFor(() => expect(s.streamer.send).toHaveBeenCalled());
  });

  it("dismisses by run id, and sends nothing for a card without one", () => {
    const s = setup();
    const withRun = planCard(s.t, "run-8");
    const without = planCard(s.t, "");
    s.actions.rejectPlan(without.id);
    expect(s.client.calls.dismissPlan).not.toHaveBeenCalled();
    s.actions.rejectPlan(withRun.id);
    expect(s.client.calls.dismissPlan).toHaveBeenCalledWith("run-8");
    expect(s.streamer.send).not.toHaveBeenCalled();
  });
});

describe("ItemActions team and visualization cards", () => {
  it("asks the main agent to respawn a sub-agent with the new task", () => {
    const s = setup();
    s.actions.retryAgent("reviewer", "check the tests");
    expect(s.streamer.send).toHaveBeenCalledWith(
      "Please retry the reviewer sub-agent with this task:\n\ncheck the tests",
    );
  });

  it("stops one sub-agent and cancels a workflow by their ids", () => {
    const s = setup();
    s.actions.stopAgent("sub-1");
    s.actions.cancelWorkflow({ workflowRunId: "wf_1" });
    expect(s.client.rpc).toHaveBeenCalledWith("cancel_agent_run", { run_id: "sub-1" });
    expect(s.client.rpc).toHaveBeenCalledWith("cancel_workflow", { workflow_run_id: "wf_1" });
  });

  it("returns the backend's answer to a visualization action, or nothing when it fails", async () => {
    const s = setup();
    s.client.rpc.mockResolvedValueOnce({ ok: true, action: "pick", params: { id: 2 } });
    const answer = await s.actions.dispatchVisualizationAction("pick", { id: 2 });
    expect(answer).toMatchObject({ ok: true, action: "pick", params: { id: 2 } });
    expect(s.client.rpc).toHaveBeenCalledWith("dispatch_visualization_action", { action: "pick", params: { id: 2 } });

    vi.spyOn(console, "warn").mockImplementation(() => {});
    s.client.rpc.mockRejectedValueOnce(new Error("gone"));
    expect(await s.actions.dispatchVisualizationAction("pick", {})).toBeUndefined();
  });
});
