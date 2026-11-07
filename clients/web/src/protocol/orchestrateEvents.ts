/**
 * The ``orchestrate_event`` push channel: the events ``orchestrate.py``
 * emits while a team or a spawned agent runs, plus the ``card_id`` that
 * names the card they belong to.
 */

import { WirePayload } from "./wirePayload";

export interface AgentStartedOrchestrateEvent {
  type: "agent_started";
  agent_path: string;
  agent: string;
  parent: string | null;
  run_id?: string;
  task?: string;
}

export interface AgentPausedOrchestrateEvent {
  type: "agent_paused";
  agent_path: string;
  count?: number;
}

export interface AgentCompletedOrchestrateEvent {
  type: "agent_completed";
  agent_path: string;
  is_error: boolean;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
}

export interface ToolStartedOrchestrateEvent {
  type: "tool_started";
  agent_path: string;
  tool: string;
  tool_call_id?: string;
  args: string;
}

export interface ToolCompletedOrchestrateEvent {
  type: "tool_completed";
  agent_path: string;
  tool: string;
  tool_call_id?: string;
  result: string;
  is_error: boolean;
}

export interface ContentPreviewOrchestrateEvent {
  type: "content_preview";
  agent_path: string;
  /** The BE's whole preview window, lines joined by ``\n``. */
  text: string;
}

export interface RunErrorOrchestrateEvent {
  type: "run_error";
  agent_path: string;
  error: string;
}

export interface TaskCreatedOrchestrateEvent {
  type: "task_created";
  agent_path: string;
  title: string;
  assignee?: string;
}

export interface TaskUpdatedOrchestrateEvent {
  type: "task_updated";
  agent_path: string;
  status: string;
}

export type OrchestrateEvent =
  | AgentStartedOrchestrateEvent
  | AgentPausedOrchestrateEvent
  | AgentCompletedOrchestrateEvent
  | ToolStartedOrchestrateEvent
  | ToolCompletedOrchestrateEvent
  | ContentPreviewOrchestrateEvent
  | RunErrorOrchestrateEvent
  | TaskCreatedOrchestrateEvent
  | TaskUpdatedOrchestrateEvent;

/** One event and the card it routes to. ``cardId`` is empty when the
 *  BE did not stamp one; the event then folds into the last active card. */
export interface OrchestrateEventEnvelope {
  cardId: string;
  event: OrchestrateEvent;
}

type EventReaders = {
  [K in OrchestrateEvent["type"]]: (agentPath: string) => Extract<OrchestrateEvent, { type: K }>;
};

/** Reads one ``orchestrate_event`` payload through one private reader
 *  per known event ``type``. */
class OrchestrateEventParser {
  private readonly readers: EventReaders = {
    agent_started: (agentPath) => this.agentStarted(agentPath),
    agent_paused: (agentPath) => this.agentPaused(agentPath),
    agent_completed: (agentPath) => this.agentCompleted(agentPath),
    tool_started: (agentPath) => this.toolStarted(agentPath),
    tool_completed: (agentPath) => this.toolCompleted(agentPath),
    content_preview: (agentPath) => this.contentPreview(agentPath),
    run_error: (agentPath) => this.runError(agentPath),
    task_created: (agentPath) => this.taskCreated(agentPath),
    task_updated: (agentPath) => this.taskUpdated(agentPath),
  };

  constructor(private readonly p: WirePayload) {}

  parse(): OrchestrateEventEnvelope | null {
    const type = this.p.string("type");
    const agentPath = this.p.optionalString("agent_path");
    if (!this.isEventType(type) || agentPath === undefined) return null;
    const read = this.readers[type] as (agentPath: string) => OrchestrateEvent;
    return { cardId: this.p.text("card_id"), event: read(agentPath) };
  }

  private isEventType(type: string): type is OrchestrateEvent["type"] {
    return Object.prototype.hasOwnProperty.call(this.readers, type);
  }

  private agentStarted(agent_path: string): AgentStartedOrchestrateEvent {
    return {
      type: "agent_started",
      agent_path,
      agent: this.p.string("agent"),
      parent: this.p.optionalString("parent") ?? null,
      run_id: this.p.optionalString("run_id"),
      task: this.p.optionalString("task"),
    };
  }

  private agentPaused(agent_path: string): AgentPausedOrchestrateEvent {
    return { type: "agent_paused", agent_path, count: this.p.optionalNumber("count") };
  }

  private agentCompleted(agent_path: string): AgentCompletedOrchestrateEvent {
    return {
      type: "agent_completed",
      agent_path,
      is_error: this.p.flag("is_error"),
      input_tokens: this.p.optionalNumber("input_tokens"),
      output_tokens: this.p.optionalNumber("output_tokens"),
      reasoning_tokens: this.p.optionalNumber("reasoning_tokens"),
    };
  }

  private toolStarted(agent_path: string): ToolStartedOrchestrateEvent {
    return {
      type: "tool_started",
      agent_path,
      tool: this.p.string("tool"),
      tool_call_id: this.p.optionalString("tool_call_id") || undefined,
      args: this.p.string("args"),
    };
  }

  private toolCompleted(agent_path: string): ToolCompletedOrchestrateEvent {
    return {
      type: "tool_completed",
      agent_path,
      tool: this.p.string("tool"),
      tool_call_id: this.p.optionalString("tool_call_id") || undefined,
      result: this.p.string("result"),
      is_error: this.p.flag("is_error"),
    };
  }

  private contentPreview(agent_path: string): ContentPreviewOrchestrateEvent {
    return { type: "content_preview", agent_path, text: this.p.string("text") };
  }

  private runError(agent_path: string): RunErrorOrchestrateEvent {
    return { type: "run_error", agent_path, error: this.p.text("error") };
  }

  private taskCreated(agent_path: string): TaskCreatedOrchestrateEvent {
    return {
      type: "task_created",
      agent_path,
      title: this.p.string("title"),
      assignee: this.p.optionalString("assignee"),
    };
  }

  private taskUpdated(agent_path: string): TaskUpdatedOrchestrateEvent {
    return { type: "task_updated", agent_path, status: this.p.string("status") };
  }
}

/** The typed event an ``orchestrate_event`` push carries, or ``null``
 *  when the payload is not one (a ``visualization_delta``, an event type
 *  this client does not know, or no ``agent_path``). */
export function parseOrchestrateEvent(payload: unknown): OrchestrateEventEnvelope | null {
  return new OrchestrateEventParser(new WirePayload(payload)).parse();
}
