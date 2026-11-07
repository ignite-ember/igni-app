/**
 * What the non-message rows ask for: a plan card's Approve / Refine, a
 * team card's per-agent Stop and Retry, a workflow card's Rerun and
 * Cancel, and an interactive visualization's actions.
 */

import type { BackendCalls } from "../protocol/backendCalls";
import type { IgniClient } from "../protocol/client";
import { VisualizationActionResult } from "../protocol/rpcResults";
import type { ChatItem } from "./chatItem";
import type { RunStreamer } from "./runStreamer";
import type { TranscriptView } from "./transcriptView";
import type { WorkflowLauncher } from "./workflowLauncher";

export interface ItemActionsDeps {
  client: Pick<IgniClient, "rpc"> & { calls: Pick<BackendCalls, "approvePlan" | "dismissPlan"> };
  view: TranscriptView;
  streamer: Pick<RunStreamer, "send">;
  workflows: Pick<WorkflowLauncher, "start">;
}

export class ItemActions {
  constructor(private readonly deps: ItemActionsDeps) {}

  /** Persist the approval (the backend flips the mode back and pushes
   *  ``plan_decided``, which updates the card), then wake the agent
   *  with a message. */
  readonly approvePlan = (id: number): void => {
    const runId = this.planRunId(id);
    void (async () => {
      if (runId) {
        try {
          await this.deps.client.calls.approvePlan(runId);
        } catch (e) {
          console.warn("approve_plan RPC failed", e);
        }
      }
      await this.deps.streamer.send("Plan approved — execute it now.");
    })();
  };

  /** Persist the dismissal; the session stays in plan mode. */
  readonly rejectPlan = (id: number): void => {
    const runId = this.planRunId(id);
    if (!runId) return;
    void this.deps.client.calls.dismissPlan(runId).catch((e) => {
      console.warn("dismiss_plan RPC failed", e);
    });
  };

  readonly stopAgent = (runId: string): void => {
    void this.deps.client
      .rpc("cancel_agent_run", { run_id: runId })
      .catch((err) => console.warn("cancel_agent_run failed", err));
  };

  /** A free-form follow-up asking the main agent to respawn the
   *  specialist, so the model can pick the right mode. */
  readonly retryAgent = (agentName: string, newTask: string): void => {
    void this.deps.streamer.send(
      `Please retry the ${agentName} sub-agent with this task:\n\n${newTask}`,
    );
  };

  /** As ``/workflows`` starts one: the card appears under the run id
   *  ``run_workflow`` answered with, so its events fold into it. */
  readonly rerunWorkflow = (wf: { name: string; args?: Record<string, unknown> }): void => {
    void this.deps.workflows
      .start(wf.name, wf.args ?? {})
      .then((resp) => this.deps.view.update((t) => t.startWorkflow(resp.name, resp.workflowRunId)))
      .catch((err) => console.warn("run_workflow failed", err));
  };

  readonly cancelWorkflow = (wf: { workflowRunId: string }): void => {
    void this.deps.client
      .rpc("cancel_workflow", { workflow_run_id: wf.workflowRunId })
      .catch((err) => console.warn("cancel_workflow failed", err));
  };

  /** Recorded by the backend for any agent watching
   *  ``session._visualization_actions``. */
  readonly dispatchVisualizationAction = async (
    action: string,
    params: Record<string, unknown>,
  ): Promise<VisualizationActionResult | undefined> => {
    try {
      return VisualizationActionResult.parse(
        await this.deps.client.rpc<unknown>("dispatch_visualization_action", { action, params }),
      );
    } catch (e) {
      console.warn("dispatch_visualization_action failed", e);
      return undefined;
    }
  };

  private planRunId(id: number): string {
    const card = this.deps.view
      .current()
      .items.find((it): it is Extract<ChatItem, { kind: "plan" }> => it.kind === "plan" && it.id === id);
    return card?.runId ?? "";
  }
}
