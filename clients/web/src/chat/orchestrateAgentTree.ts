/**
 * The per-agent tree of one orchestrate card, folded from the
 * ``orchestrate_event`` stream.
 */

import type {
  AgentCompletedOrchestrateEvent,
  AgentPausedOrchestrateEvent,
  AgentStartedOrchestrateEvent,
  ContentPreviewOrchestrateEvent,
  OrchestrateEvent,
  RunErrorOrchestrateEvent,
  ToolCompletedOrchestrateEvent,
  ToolStartedOrchestrateEvent,
} from "../protocol/orchestrateEvents";
import type { OrchestrateItem } from "./chatItem";
import type { ChatItemIds } from "./chatItemIds";

/** One sub-agent's slice of an orchestrate run. */
export interface OrchestrateAgent {
  path: string;
  name: string;
  parent: string | null;
  status: "running" | "done" | "error" | "paused";
  /** Agno run id of a team member's run, for its Stop button; empty on
   *  the standalone ``spawn_agent`` path. */
  runId: string;
  /** The task the parent gave it, which Retry pre-fills. */
  task: string;
  /** The tail of its streamed content, at most ``PREVIEW_WINDOW`` lines. */
  previewLines: string[];
  tools: OrchestrateToolCall[];
  /** Zero until the agent finishes. */
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/** Matches ``PreviewFormatter.WINDOW`` in ``core/tools/orchestrate_preview.py``,
 *  which owns the window contents. */
export const PREVIEW_WINDOW = 5;

export interface OrchestrateToolCall {
  id: number;
  /** Agno's tool execution id; tells overlapping same-name calls apart. */
  toolCallId?: string;
  tool: string;
  args: string;
  status: "running" | "done" | "error";
  result: string;
}

type Handlers = {
  [K in OrchestrateEvent["type"]]: (
    ev: Extract<OrchestrateEvent, { type: K }>,
  ) => OrchestrateAgentTree;
};

/** Immutable: ``apply`` returns a new tree, or ``this`` when the event
 *  changed nothing, so a caller can skip the re-render. */
export class OrchestrateAgentTree {
  private readonly handlers: Handlers = {
    agent_started: (ev) => this.onAgentStarted(ev),
    agent_paused: (ev) => this.onAgentPaused(ev),
    agent_completed: (ev) => this.onAgentCompleted(ev),
    tool_started: (ev) => this.onToolStarted(ev),
    tool_completed: (ev) => this.onToolCompleted(ev),
    content_preview: (ev) => this.onContentPreview(ev),
    run_error: (ev) => this.onRunError(ev),
    task_created: (ev) => this.withAgent(ev.agent_path),
    task_updated: (ev) => this.withAgent(ev.agent_path),
  };

  constructor(
    readonly agents: Record<string, OrchestrateAgent>,
    readonly order: string[],
    private readonly ids: ChatItemIds,
  ) {}

  static empty(ids: ChatItemIds): OrchestrateAgentTree {
    return new OrchestrateAgentTree({}, [], ids);
  }

  static of(item: OrchestrateItem, ids: ChatItemIds): OrchestrateAgentTree {
    return new OrchestrateAgentTree(item.agents, item.order, ids);
  }

  /** Some agent is still running or paused. An empty card counts as
   *  active: its team has not spun up yet. */
  isActive(): boolean {
    if (this.order.length === 0) return true;
    return this.order.some((p) => {
      const a = this.agents[p];
      return a && (a.status === "running" || a.status === "paused");
    });
  }

  apply(ev: OrchestrateEvent): OrchestrateAgentTree {
    const handle = this.handlers[ev.type] as (ev: OrchestrateEvent) => OrchestrateAgentTree;
    return handle(ev);
  }

  /** The tree with an agent at ``path``: ``this`` when it is there. */
  private withAgent(path: string, name?: string, parent?: string | null): OrchestrateAgentTree {
    if (this.agents[path]) return this;
    const created: OrchestrateAgent = {
      path,
      name: name || path.split(".").pop() || path,
      parent: parent ?? null,
      status: "running",
      previewLines: [],
      tools: [],
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      runId: "",
      task: "",
    };
    const order = this.order.includes(path) ? this.order : [...this.order, path];
    return new OrchestrateAgentTree({ ...this.agents, [path]: created }, order, this.ids);
  }

  private put(agent: OrchestrateAgent): OrchestrateAgentTree {
    return new OrchestrateAgentTree({ ...this.agents, [agent.path]: agent }, this.order, this.ids);
  }

  private onAgentStarted(ev: AgentStartedOrchestrateEvent): OrchestrateAgentTree {
    const tree = this.withAgent(ev.agent_path, ev.agent, ev.parent);
    const a = tree.agents[ev.agent_path];
    const runId = a.runId || ev.run_id || "";
    const task = a.task || ev.task || "";
    if (runId === a.runId && task === a.task) return tree;
    return tree.put({ ...a, runId, task });
  }

  private onAgentPaused(ev: AgentPausedOrchestrateEvent): OrchestrateAgentTree {
    const tree = this.withAgent(ev.agent_path);
    return tree.put({ ...tree.agents[ev.agent_path], status: "paused" });
  }

  private onAgentCompleted(ev: AgentCompletedOrchestrateEvent): OrchestrateAgentTree {
    const tree = this.withAgent(ev.agent_path);
    const a = tree.agents[ev.agent_path];
    return tree.put({
      ...a,
      status: ev.is_error ? "error" : "done",
      // An error that skipped Agno's metrics ships no totals.
      inputTokens: ev.input_tokens ?? a.inputTokens,
      outputTokens: ev.output_tokens ?? a.outputTokens,
      reasoningTokens: ev.reasoning_tokens ?? a.reasoningTokens,
    });
  }

  private onToolStarted(ev: ToolStartedOrchestrateEvent): OrchestrateAgentTree {
    const tree = this.withAgent(ev.agent_path);
    const a = tree.agents[ev.agent_path];
    const tool: OrchestrateToolCall = {
      id: this.ids.next(),
      toolCallId: ev.tool_call_id,
      tool: ev.tool,
      args: ev.args,
      status: "running",
      result: "",
    };
    return tree.put({ ...a, tools: [...a.tools, tool] });
  }

  private onToolCompleted(ev: ToolCompletedOrchestrateEvent): OrchestrateAgentTree {
    const tree = this.withAgent(ev.agent_path);
    const a = tree.agents[ev.agent_path];
    return tree.put({ ...a, tools: this.completeTool(a.tools, ev) });
  }

  private onContentPreview(ev: ContentPreviewOrchestrateEvent): OrchestrateAgentTree {
    const tree = this.withAgent(ev.agent_path);
    const a = tree.agents[ev.agent_path];
    // ``text`` is the whole window; replace rather than append.
    const lines = ev.text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(-PREVIEW_WINDOW);
    if (lines.length === 0) return tree;
    // Previews stream ~20/s; an unchanged window must not re-render.
    const unchanged =
      a.previewLines.length === lines.length && a.previewLines.every((line, i) => line === lines[i]);
    return unchanged ? tree : tree.put({ ...a, previewLines: lines });
  }

  private onRunError(ev: RunErrorOrchestrateEvent): OrchestrateAgentTree {
    const tree = this.withAgent(ev.agent_path);
    const a = tree.agents[ev.agent_path];
    // In the preview tail too, so a collapsed card still says why.
    return tree.put({ ...a, status: "error", previewLines: this.withPreview(a, `ERROR: ${ev.error}`) });
  }

  /** Close the call by tool id when there is one, else the last running
   *  call with the same name. */
  private completeTool(
    tools: OrchestrateToolCall[],
    ev: ToolCompletedOrchestrateEvent,
  ): OrchestrateToolCall[] {
    const lastIndex = (pred: (t: OrchestrateToolCall) => boolean): number => {
      for (let i = tools.length - 1; i >= 0; i--) if (pred(tools[i])) return i;
      return -1;
    };
    let i = ev.tool_call_id ? lastIndex((t) => t.toolCallId === ev.tool_call_id) : -1;
    if (i < 0) i = lastIndex((t) => t.tool === ev.tool && t.status === "running");
    if (i < 0) return tools.slice();
    const next = tools.slice();
    next[i] = { ...tools[i], status: ev.is_error ? "error" : "done", result: ev.result };
    return next;
  }

  private withPreview(agent: OrchestrateAgent, line: string): string[] {
    return [...agent.previewLines, line].slice(-PREVIEW_WINDOW);
  }
}
