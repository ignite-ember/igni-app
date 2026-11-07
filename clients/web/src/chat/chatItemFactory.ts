/**
 * Builds chat items, each with an id from one shared allocator.
 */

import type { ToolStarted } from "../protocol/messages";
import type {
  AgentItem,
  AssistantItem,
  ChatItem,
  CompactItem,
  ErrorItem,
  InfoItem,
  OrchestrateItem,
  PlanItem,
  ShellItem,
  StatsItem,
  ThinkingItem,
  ToolItem,
  UserItem,
  VisualizationItem,
  WorkflowItem,
} from "./chatItem";
import type { ChatItemIds } from "./chatItemIds";
import type { OrchestrateAgentTree } from "./orchestrateAgentTree";
import type { PlanTask } from "./planTasks";
import { UserMessageText } from "./userMessageText";
import { WorkflowRunModel } from "./workflowRun";

export interface PlanItemInput {
  plan: string;
  tasks?: PlanTask[];
  runId?: string;
  state?: PlanItem["state"];
}

export interface VisualizationInput {
  spec: unknown;
  title: string;
  sourceAgent: string;
  specId: string;
  fromExtension?: string;
}

export type StatsInput = Omit<StatsItem, "kind" | "id">;

export class ChatItemFactory {
  constructor(readonly ids: ChatItemIds) {}

  user(text: string, fromExtension?: string): UserItem {
    const id = this.ids.next();
    return fromExtension ? { kind: "user", id, text, fromExtension } : { kind: "user", id, text };
  }

  assistant(text: string): AssistantItem {
    return { kind: "assistant", id: this.ids.next(), text };
  }

  thinking(text: string): ThinkingItem {
    return { kind: "thinking", id: this.ids.next(), text };
  }

  /** The inline marker for a sub-agent run with no orchestrate card. */
  agent(name: string): AgentItem {
    return { kind: "agent", id: this.ids.next(), text: name };
  }

  info(text: string): InfoItem {
    return { kind: "info", id: this.ids.next(), text };
  }

  error(text: string): ErrorItem {
    return { kind: "error", id: this.ids.next(), text };
  }

  shell(command: string): ShellItem {
    return { kind: "shell", id: this.ids.next(), command, output: "", exitCode: null };
  }

  plan(input: PlanItemInput): PlanItem {
    return {
      kind: "plan",
      id: this.ids.next(),
      plan: input.plan,
      state: input.state ?? "pending",
      tasks: input.tasks ?? [],
      runId: input.runId ?? "",
    };
  }

  compact(status: string, summary: string): CompactItem {
    return { kind: "compact", id: this.ids.next(), status, summary };
  }

  /** A ``/loop`` iteration card; a prompt without the wrapper still
   *  shows, as an info line. */
  loop(wrapped: string): ChatItem {
    const parsed = new UserMessageText(wrapped).loopIteration();
    if (!parsed) return this.info(`loop: ${wrapped}`);
    return { kind: "loop", id: this.ids.next(), ...parsed, raw: wrapped };
  }

  visualization(input: VisualizationInput): VisualizationItem {
    return {
      kind: "visualization",
      id: this.ids.next(),
      specId: input.specId,
      spec: input.spec,
      title: input.title,
      sourceAgent: input.sourceAgent,
      ...(input.fromExtension ? { fromExtension: input.fromExtension } : {}),
    };
  }

  workflow(name: string, workflowRunId: string, startedAtMs = Date.now()): WorkflowItem {
    return {
      kind: "workflow",
      id: this.ids.next(),
      run: WorkflowRunModel.start(name, workflowRunId, startedAtMs).state,
    };
  }

  runningTool(msg: ToolStarted): ToolItem {
    return {
      kind: "tool",
      id: this.ids.next(),
      runId: msg.run_id,
      name: msg.friendly_name || msg.tool_name,
      args: msg.args_summary,
      status: "running",
      result: "",
      isError: false,
      diffRows: null,
    };
  }

  orchestrate(cardId: string, tree: OrchestrateAgentTree): OrchestrateItem {
    return {
      kind: "orchestrate",
      id: this.ids.next(),
      cardId,
      agents: tree.agents,
      order: tree.order,
      streaming: true,
    };
  }

  stats(input: StatsInput): StatsItem {
    return { kind: "stats", id: this.ids.next(), ...input };
  }
}
