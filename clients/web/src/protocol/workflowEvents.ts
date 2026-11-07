/**
 * The ``workflow_event`` push channel: one envelope per line the BE's
 * workflow runner drained from the Node subprocess, also stored in
 * ``session_data.event_log``.
 */

import { WirePayload } from "./wirePayload";

export interface WorkflowEventEnvelope {
  workflow_run_id: string;
  name: string;
  ts: number;
  seq: number;
}

export interface WorkflowStartedEvent extends WorkflowEventEnvelope {
  type: "workflow_started";
  payload: { name?: string; args?: Record<string, unknown> };
}

export interface PhaseStartedEvent extends WorkflowEventEnvelope {
  type: "phase_started";
  payload: { phase_id: string; title: string };
}

export interface PhaseCompletedEvent extends WorkflowEventEnvelope {
  type: "phase_completed";
  payload: { phase_id: string; status: "completed" | "failed" | "cancelled" };
}

export interface ParallelStartedEvent extends WorkflowEventEnvelope {
  type: "parallel_started";
  payload: { group_id?: string };
}

export interface ParallelCompletedEvent extends WorkflowEventEnvelope {
  type: "parallel_completed";
  payload: { group_id?: string };
}

export interface AgentStartedEvent extends WorkflowEventEnvelope {
  type: "agent_started";
  payload: { id: string; label: string };
}

export interface AgentCompletedEvent extends WorkflowEventEnvelope {
  type: "agent_completed";
  payload: {
    id: string;
    status: "completed" | "failed" | "timeout";
    result?: unknown;
    error?: string;
  };
}

export interface WorkflowCompletedEvent extends WorkflowEventEnvelope {
  type: "workflow_completed";
  payload: { status: "completed" | "failed" | "cancelled"; result?: unknown };
}

export interface WorkflowFailedEvent extends WorkflowEventEnvelope {
  type: "workflow_failed";
  payload: { error: string; status: "failed" | "cancelled" };
}

/** ``log``, ``pipeline_*``, ``agent_request``, ``workflow_meta`` and
 *  anything newer: kept on the tape, not interpreted. */
export interface UnrecognizedWorkflowEvent extends WorkflowEventEnvelope {
  type: "unrecognized";
  wireType: string;
  payload: unknown;
}

export type WorkflowEvent =
  | WorkflowStartedEvent
  | PhaseStartedEvent
  | PhaseCompletedEvent
  | ParallelStartedEvent
  | ParallelCompletedEvent
  | AgentStartedEvent
  | AgentCompletedEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent
  | UnrecognizedWorkflowEvent;

type KnownWorkflowEvent = Exclude<WorkflowEvent, UnrecognizedWorkflowEvent>;

type PayloadReaders = {
  [K in KnownWorkflowEvent["type"]]: () => Extract<WorkflowEvent, { type: K }>["payload"];
};

/** Reads one envelope: the outer fields here, the ``payload`` object
 *  through one private reader per known ``type``. */
class WorkflowEventParser {
  private readonly readers: PayloadReaders = {
    workflow_started: () => this.workflowStarted(),
    phase_started: () => this.phaseStarted(),
    phase_completed: () => this.phaseCompleted(),
    parallel_started: () => this.parallel(),
    parallel_completed: () => this.parallel(),
    agent_started: () => this.agentStarted(),
    agent_completed: () => this.agentCompleted(),
    workflow_completed: () => this.workflowCompleted(),
    workflow_failed: () => this.workflowFailed(),
  };

  private readonly payload: WirePayload;

  constructor(private readonly wire: WirePayload) {
    this.payload = new WirePayload(wire.value("payload"));
  }

  parse(): WorkflowEvent | null {
    const workflowRunId = this.wire.optionalString("workflow_run_id");
    const type = this.wire.optionalString("type");
    if (workflowRunId === undefined || type === undefined) return null;
    const envelope: WorkflowEventEnvelope = {
      workflow_run_id: workflowRunId,
      name: this.wire.string("name"),
      ts: this.wire.optionalNumber("ts") ?? 0,
      seq: this.wire.optionalNumber("seq") ?? 0,
    };
    if (!this.isKnownType(type)) {
      return { ...envelope, type: "unrecognized", wireType: type, payload: this.wire.value("payload") };
    }
    return { ...envelope, type, payload: this.readers[type]() } as KnownWorkflowEvent;
  }

  private isKnownType(type: string): type is KnownWorkflowEvent["type"] {
    return Object.prototype.hasOwnProperty.call(this.readers, type);
  }

  private workflowStarted(): WorkflowStartedEvent["payload"] {
    return { name: this.payload.optionalString("name"), args: this.payload.plainObject("args") };
  }

  private phaseStarted(): PhaseStartedEvent["payload"] {
    return {
      phase_id: this.payload.string("phase_id"),
      title: this.payload.string("title", "(unnamed phase)"),
    };
  }

  private phaseCompleted(): PhaseCompletedEvent["payload"] {
    return {
      phase_id: this.payload.string("phase_id"),
      status: this.payload.oneOf("status", ["completed", "failed", "cancelled"], "completed"),
    };
  }

  private parallel(): ParallelStartedEvent["payload"] {
    return { group_id: this.payload.optionalString("group_id") };
  }

  private agentStarted(): AgentStartedEvent["payload"] {
    return { id: this.payload.string("id"), label: this.payload.string("label", "agent") };
  }

  private agentCompleted(): AgentCompletedEvent["payload"] {
    return {
      id: this.payload.string("id"),
      status: this.payload.oneOf("status", ["completed", "failed", "timeout"], "completed"),
      result: this.payload.value("result"),
      error: this.payload.optionalString("error"),
    };
  }

  private workflowCompleted(): WorkflowCompletedEvent["payload"] {
    return {
      status: this.payload.oneOf("status", ["completed", "failed", "cancelled"], "completed"),
      result: this.payload.value("result"),
    };
  }

  private workflowFailed(): WorkflowFailedEvent["payload"] {
    return {
      error: this.payload.string("error", "workflow failed"),
      status: this.payload.oneOf("status", ["failed", "cancelled"], "failed"),
    };
  }
}

/** The typed event, or ``null`` when ``raw`` is not a workflow envelope
 *  (no string ``workflow_run_id`` or ``type``). */
export function parseWorkflowEvent(raw: unknown): WorkflowEvent | null {
  return new WorkflowEventParser(new WirePayload(raw)).parse();
}
