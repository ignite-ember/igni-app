/**
 * What a transcript row can ask the app to do, grouped by the item kind
 * that asks. Every group and every callback is optional: a row whose
 * callback is missing hides or disables the control.
 */

import type { ChatItem, ChatItemOf, UserItem } from "../../chat/chatItem";
import type { WorkflowRunState } from "../../chat/workflowRun";
import type { DispatchAction } from "../JsonRenderView";

export interface UserItemHandlers {
  /** Truncate history from this message and resend it as ``newText``. */
  readonly edit?: (item: UserItem, newText: string) => void;
  /** Truncate history from this message. */
  readonly delete?: (item: UserItem) => void;
}

export interface TeamHandlers {
  /** Cancel the whole top-level run: the team and every sub-agent. */
  readonly stopTeam?: () => void;
  /** Cancel one sub-agent by its run id; its siblings keep going. */
  readonly stopAgent?: (runId: string) => void;
  /** Ask the main agent to respawn a failed sub-agent with a new task. */
  readonly retryAgent?: (agentName: string, newTask: string) => void;
}

export interface PlanHandlers {
  /** Exit plan mode and let the agent execute the plan. */
  readonly approve?: (id: number) => void;
  /** Dismiss the plan and stay in plan mode. */
  readonly reject?: (id: number) => void;
}

/** The recovery banner under an interrupted assistant bubble. */
export interface InterruptedHandlers {
  /** Re-fire the original prompt with ``force=true``. */
  readonly retry?: (assistantItemId: number) => void;
  /** Drop the partial reply and the backend's interrupted record. */
  readonly discard?: (assistantItemId: number) => void;
  /** Drop the partial reply and seed the composer with the prompt. */
  readonly editPrompt?: (assistantItemId: number) => void;
}

export interface WorkflowHandlers {
  readonly rerun?: (run: WorkflowRunState) => void;
  readonly cancel?: (run: WorkflowRunState) => void;
}

export interface VisualizationHandlers {
  /** An interactive component's action, sent to the backend. Without
   *  it, actions log locally and do nothing. */
  readonly dispatchAction?: DispatchAction;
}

/**
 * ``ChatItemView`` is memoised, so the app must build this once (with
 * ``useMemo`` over stable callbacks): a fresh object per render would
 * re-render every row on every streamed token.
 */
export interface ChatItemHandlers {
  readonly user?: UserItemHandlers;
  readonly team?: TeamHandlers;
  readonly plan?: PlanHandlers;
  readonly interrupted?: InterruptedHandlers;
  readonly workflow?: WorkflowHandlers;
  readonly visualization?: VisualizationHandlers;
}

/** What the renderer of one item kind is given. */
export interface ItemRendererProps<K extends ChatItem["kind"]> {
  item: ChatItemOf<K>;
  handlers: ChatItemHandlers;
  /** Only the ``stats`` row reads it: the reply its copy button copies. */
  copyResponseText?: string;
}
