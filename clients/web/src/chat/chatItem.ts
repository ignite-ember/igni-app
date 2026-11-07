/**
 * One entry in the conversation, as a plain immutable value.
 *
 * Items stay plain objects because React state holds them and the
 * renderer compares them by reference; behaviour over a list of them
 * lives on ``ChatTranscript``.
 */

import type { DiffRow } from "../protocol/messages";
import type { OrchestrateAgent } from "./orchestrateAgentTree";
import type { PlanTask } from "./planTasks";
import type { WorkflowRunState } from "./workflowRun";

/**
 * Why an assistant turn did not complete; mirrors the wire-side
 * ``InterruptedRun.reason``.
 *
 * - ``cancelled``: the user stopped the stream.
 * - ``errored``: the agent raised mid-run.
 * - ``abandoned``: the BE went away without a terminal event.
 */
export type AssistantInterrupted = "cancelled" | "errored" | "abandoned";

/** ``rejected``: never ran — refused in the approval dialog, or nobody
 *  could be asked. Neither a success nor a failure. */
export type ToolStatus = "running" | "done" | "error" | "rejected";

export interface AttachedFile {
  name: string;
  path: string;
}

export interface UserItem {
  kind: "user";
  id: number;
  text: string;
  /** The extension that posted it (``host.chat.post``), by id; absent
   *  for the person's own messages. */
  fromExtension?: string;
  /** Run that owns this message; edit and delete truncate from it. */
  runId?: string;
  /** Epoch ms of ``run_started``. */
  startedAt?: number;
  /** Epoch ms of ``streaming_done``: when the visible answer ended. */
  streamingEndedAt?: number;
  /** The BE has persisted the run, so ``truncate_history`` knows it. */
  persisted?: boolean;
}

export interface AssistantItem {
  kind: "assistant";
  id: number;
  text: string;
  /** Set when the turn did not complete normally. */
  interrupted?: AssistantInterrupted;
}

export interface ThinkingItem {
  kind: "thinking";
  id: number;
  text: string;
}

export interface ToolItem {
  kind: "tool";
  id: number;
  runId: string;
  name: string;
  args: string;
  status: ToolStatus;
  result: string;
  isError: boolean;
  diffRows: DiffRow[] | null;
  /** The sub-agent that called the tool; empty for the main team. */
  agentName?: string;
}

export interface AgentItem {
  kind: "agent";
  id: number;
  text: string;
}

/** Live progress of one team or spawned agent. ``cardId`` is the
 *  BE-stamped id every event of that spawn carries; ``streaming``
 *  turns off when the owning top-level run completes. */
export interface OrchestrateItem {
  kind: "orchestrate";
  id: number;
  cardId: string;
  agents: Record<string, OrchestrateAgent>;
  order: string[];
  streaming: boolean;
}

export interface InfoItem {
  kind: "info";
  id: number;
  text: string;
}

export interface ErrorItem {
  kind: "error";
  id: number;
  text: string;
}

/** Result of /compact. ``summary`` is empty when none was generated. */
export interface CompactItem {
  kind: "compact";
  id: number;
  status: string;
  summary: string;
}

/** A plan submitted through ``exit_plan_mode``. */
export interface PlanItem {
  kind: "plan";
  id: number;
  plan: string;
  state: "pending" | "approved" | "dismissed";
  /** The structured checklist, matched by ``content`` as todos update. */
  tasks: PlanTask[];
  /** Key for ``approve_plan`` / ``dismiss_plan``; empty when unknown. */
  runId: string;
}

/** One ``/loop`` iteration: its number and the user's own ask. */
export interface LoopItem {
  kind: "loop";
  id: number;
  index: number;
  total: number | null;
  body: string;
  /** The full wrapped prompt the model received. */
  raw: string;
}

export interface ShellItem {
  kind: "shell";
  id: number;
  command: string;
  output: string;
  exitCode: number | null;
}

export interface AttachmentsItem {
  kind: "attachments";
  id: number;
  files: AttachedFile[];
}

/** A json-render spec. ``specId`` is the dedupe key: a later spec with
 *  the same id replaces this card's content in place. */
export interface VisualizationItem {
  kind: "visualization";
  id: number;
  specId: string;
  /** Treated as immutable: the renderer memoizes on its identity. */
  spec: unknown;
  title: string;
  /** ``visualizer``, or the id of the extension that appended it. */
  sourceAgent: string;
  /** Set when an extension appended the card: its id. */
  fromExtension?: string;
}

/** Roll-up of one top-level run. */
export interface StatsItem {
  kind: "stats";
  id: number;
  runId: string;
  /** Billed input; replaced by ``count_context_tokens`` once known. */
  inputTokens: number;
  /** Billed output, including invisible scratch tokens. */
  outputTokens: number;
  /** Billed reasoning tokens. */
  reasoningTokens: number;
  /** Estimated from the rendered thinking text. */
  visibleThinkTokens: number;
  /** Estimated from the rendered reply text. */
  visibleOutTokens: number;
  duration: number;
  /** ``inputTokens`` holds the real session size. */
  corrected: boolean;
}

export interface WorkflowItem {
  kind: "workflow";
  id: number;
  run: WorkflowRunState;
}

export type ChatItem =
  | UserItem
  | AssistantItem
  | ThinkingItem
  | ToolItem
  | AgentItem
  | OrchestrateItem
  | InfoItem
  | ErrorItem
  | CompactItem
  | PlanItem
  | LoopItem
  | ShellItem
  | AttachmentsItem
  | VisualizationItem
  | StatsItem
  | WorkflowItem;

export type ChatItemOf<K extends ChatItem["kind"]> = Extract<ChatItem, { kind: K }>;
