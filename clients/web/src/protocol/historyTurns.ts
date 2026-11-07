/**
 * One turn of ``get_chat_history`` (or ``get_pending_messages``), keyed
 * by ``role``. Coercion happens here, once: strings via ``String(x ?? "")``
 * and numbers via ``Number(x) || 0``, so a stringly or missing field
 * never reaches the mapper as ``undefined`` or ``NaN``.
 */

import { WirePayload } from "./wirePayload";

interface TurnBase {
  run_id: string;
}

export interface UserTurn extends TurnBase {
  role: "user";
  content: string;
}

export interface AssistantTurn extends TurnBase {
  role: "assistant";
  content: string;
}

/** Synthesised from an assistant message's ``reasoning_content``. */
export interface ThinkingTurn extends TurnBase {
  role: "thinking";
  content: string;
}

/** ``tool_started`` and ``tool_completed`` squashed into one turn. */
export interface ToolTurn extends TurnBase {
  role: "tool";
  content: string;
  /** ``friendly_name``, else ``tool_name``. */
  name: string;
  args: string;
  is_error: boolean;
  is_rejected: boolean;
}

/** Spliced in where ``exit_plan_mode`` returned. */
export interface PlanTurn extends TurnBase {
  role: "plan";
  plan: string;
  tasks: unknown;
  state: string;
}

/** Spliced in from the session event log, at the tool call it came from. */
export interface VisualizationTurn extends TurnBase {
  role: "visualization";
  spec: unknown;
  spec_id: string;
  title: string;
  source_agent: string;
  extension_id: string;
}

/** One per completed top-level run. */
export interface StatsTurn extends TurnBase {
  role: "stats";
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  duration: number;
}

/** A role this client does not render (``system``, anything newer). */
export interface UnknownTurn extends TurnBase {
  role: "unknown";
  wireRole: string;
}

export type HistoryTurn =
  | UserTurn
  | AssistantTurn
  | ThinkingTurn
  | ToolTurn
  | PlanTurn
  | VisualizationTurn
  | StatsTurn
  | UnknownTurn;

type KnownTurn = Exclude<HistoryTurn, UnknownTurn>;

type TurnReaders = {
  [K in KnownTurn["role"]]: (run_id: string) => Extract<HistoryTurn, { role: K }>;
};

/** Reads one turn through one private reader per known ``role``. */
class HistoryTurnParser {
  private readonly readers: TurnReaders = {
    user: (run_id) => ({ role: "user", run_id, content: this.p.text("content") }),
    assistant: (run_id) => ({ role: "assistant", run_id, content: this.p.text("content") }),
    thinking: (run_id) => ({ role: "thinking", run_id, content: this.p.text("content") }),
    tool: (run_id) => this.tool(run_id),
    plan: (run_id) => this.plan(run_id),
    visualization: (run_id) => this.visualization(run_id),
    stats: (run_id) => this.stats(run_id),
  };

  constructor(private readonly p: WirePayload) {}

  parse(): HistoryTurn {
    const role = this.p.text("role");
    const run_id = this.p.text("run_id");
    if (!this.isKnownRole(role)) return { role: "unknown", wireRole: role, run_id };
    const read = this.readers[role] as (run_id: string) => HistoryTurn;
    return read(run_id);
  }

  private isKnownRole(role: string): role is KnownTurn["role"] {
    return Object.prototype.hasOwnProperty.call(this.readers, role);
  }

  private tool(run_id: string): ToolTurn {
    return {
      role: "tool",
      run_id,
      content: this.p.text("content"),
      name: String(this.p.value("friendly_name") ?? this.p.value("tool_name") ?? ""),
      args: this.p.text("args"),
      is_error: this.p.flag("is_error"),
      is_rejected: this.p.flag("is_rejected"),
    };
  }

  private plan(run_id: string): PlanTurn {
    return {
      role: "plan",
      run_id,
      plan: this.p.text("plan"),
      tasks: this.p.value("tasks"),
      state: this.p.text("state"),
    };
  }

  private visualization(run_id: string): VisualizationTurn {
    return {
      role: "visualization",
      run_id,
      spec: this.p.value("spec"),
      spec_id: this.p.text("spec_id"),
      title: this.p.text("title"),
      source_agent: this.p.text("source_agent", "visualizer"),
      extension_id: this.p.text("extension_id"),
    };
  }

  private stats(run_id: string): StatsTurn {
    return {
      role: "stats",
      run_id,
      input_tokens: this.p.number("input_tokens"),
      output_tokens: this.p.number("output_tokens"),
      reasoning_tokens: this.p.number("reasoning_tokens"),
      duration: this.p.number("duration"),
    };
  }
}

export function parseHistoryTurn(raw: unknown): HistoryTurn {
  return new HistoryTurnParser(new WirePayload(raw)).parse();
}
