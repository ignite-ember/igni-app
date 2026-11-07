/**
 * One workflow run as the renderer sees it, folded from its
 * ``workflow_event`` tape.
 */

import type {
  AgentCompletedEvent,
  AgentStartedEvent,
  ParallelStartedEvent,
  PhaseCompletedEvent,
  PhaseStartedEvent,
  WorkflowCompletedEvent,
  WorkflowEvent,
  WorkflowFailedEvent,
  WorkflowStartedEvent,
} from "../protocol/workflowEvents";

export interface WorkflowRunState {
  workflowRunId: string;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAtMs: number;
  endedAtMs?: number;
  phases: WorkflowPhase[];
  /** Every event received, in order, for replay and diagnostics. */
  events: WorkflowEvent[];
  result?: unknown;
  error?: string;
  /** The args the run was started with, which Rerun sends again. */
  args?: Record<string, unknown>;
  /** The ``parallel()`` block open right now: agents that start inside
   *  it join its group. */
  activeParallelGroupId?: string;
}

export interface WorkflowPhase {
  phaseId: string;
  title: string;
  startedAtMs: number;
  endedAtMs?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  agents: WorkflowAgentRun[];
}

export interface WorkflowAgentRun {
  /** Stable across the run. */
  agentId: string;
  label: string;
  status: "running" | "completed" | "failed" | "timeout";
  startedAtMs: number;
  endedAtMs?: number;
  result?: unknown;
  error?: string;
  /** The ``parallel()`` block it ran in; the renderer lays a group's
   *  agents side by side. Undefined for a serial agent. */
  parallelGroupId?: string;
}

type Handlers = {
  [K in WorkflowEvent["type"]]: (ev: Extract<WorkflowEvent, { type: K }>) => WorkflowRunModel;
};

/** Immutable: ``apply`` returns a new model. */
export class WorkflowRunModel {
  private readonly handlers: Handlers = {
    workflow_started: (ev) => this.onWorkflowStarted(ev),
    phase_started: (ev) => this.onPhaseStarted(ev),
    phase_completed: (ev) => this.onPhaseCompleted(ev),
    parallel_started: (ev) => this.onParallelStarted(ev),
    parallel_completed: () => this.with({ activeParallelGroupId: undefined }),
    agent_started: (ev) => this.onAgentStarted(ev),
    agent_completed: (ev) => this.onAgentCompleted(ev),
    workflow_completed: (ev) => this.onWorkflowCompleted(ev),
    workflow_failed: (ev) => this.onWorkflowFailed(ev),
    unrecognized: () => this,
  };

  constructor(readonly state: WorkflowRunState) {}

  static start(name: string, workflowRunId: string, startedAtMs: number): WorkflowRunModel {
    return new WorkflowRunModel({
      workflowRunId,
      name,
      status: "running",
      startedAtMs,
      phases: [],
      events: [],
    });
  }

  /** The run a persisted tape describes, or ``null`` for no events. */
  static fromEvents(events: WorkflowEvent[]): WorkflowRunModel | null {
    if (events.length === 0) return null;
    const first = events[0];
    return events.reduce(
      (run, ev) => run.apply(ev),
      WorkflowRunModel.start(first.name, first.workflow_run_id, first.ts),
    );
  }

  /** Tape the event, then fold it into the typed state. */
  apply(ev: WorkflowEvent): WorkflowRunModel {
    const taped = this.with({ events: [...this.state.events, ev] });
    const handle = taped.handlers[ev.type] as (ev: WorkflowEvent) => WorkflowRunModel;
    return handle(ev);
  }

  /** The last running phase, else the last phase. */
  currentPhase(): WorkflowPhase | null {
    const phases = this.state.phases;
    for (let i = phases.length - 1; i >= 0; i--) {
      if (phases[i].status === "running") return phases[i];
    }
    return phases.at(-1) ?? null;
  }

  private with(patch: Partial<WorkflowRunState>): WorkflowRunModel {
    return new WorkflowRunModel({ ...this.state, ...patch });
  }

  private onWorkflowStarted(ev: WorkflowStartedEvent): WorkflowRunModel {
    const { name, args } = ev.payload;
    return this.with({
      ...(name ? { name } : {}),
      ...(args ? { args } : {}),
    });
  }

  private onPhaseStarted(ev: PhaseStartedEvent): WorkflowRunModel {
    const phase: WorkflowPhase = {
      phaseId: ev.payload.phase_id,
      title: ev.payload.title,
      startedAtMs: ev.ts,
      status: "running",
      agents: [],
    };
    return this.with({ phases: [...this.state.phases, phase] });
  }

  private onPhaseCompleted(ev: PhaseCompletedEvent): WorkflowRunModel {
    const { phase_id, status } = ev.payload;
    return this.with({
      phases: this.state.phases.map((p) =>
        p.phaseId === phase_id ? { ...p, status, endedAtMs: ev.ts } : p,
      ),
    });
  }

  private onParallelStarted(ev: ParallelStartedEvent): WorkflowRunModel {
    return this.with({ activeParallelGroupId: ev.payload.group_id });
  }

  private onAgentStarted(ev: AgentStartedEvent): WorkflowRunModel {
    const phase = this.currentPhase();
    if (phase === null) return this;
    const agent: WorkflowAgentRun = {
      agentId: ev.payload.id,
      label: ev.payload.label,
      status: "running",
      startedAtMs: ev.ts,
      parallelGroupId: this.state.activeParallelGroupId,
    };
    return this.with({
      phases: this.state.phases.map((p) =>
        p.phaseId === phase.phaseId ? { ...p, agents: [...p.agents, agent] } : p,
      ),
    });
  }

  private onAgentCompleted(ev: AgentCompletedEvent): WorkflowRunModel {
    const { id, status, result, error } = ev.payload;
    return this.with({
      phases: this.state.phases.map((p) => ({
        ...p,
        agents: p.agents.map((a) =>
          a.agentId === id ? { ...a, status, endedAtMs: ev.ts, result, error } : a,
        ),
      })),
    });
  }

  private onWorkflowCompleted(ev: WorkflowCompletedEvent): WorkflowRunModel {
    return this.with({ status: ev.payload.status, endedAtMs: ev.ts, result: ev.payload.result });
  }

  private onWorkflowFailed(ev: WorkflowFailedEvent): WorkflowRunModel {
    return this.with({ status: ev.payload.status, endedAtMs: ev.ts, error: ev.payload.error });
  }
}
