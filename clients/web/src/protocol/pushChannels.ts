/**
 * The ``push_notification`` channels this client acts on, as a tagged
 * union.
 *
 * The backend sends ``{channel, payload}`` with an unread payload.
 * {@link parsePushChannel} reads each channel's payload once, through
 * {@link WirePayload}, so the router that acts on them never casts.
 * A channel this client does not know, or a payload missing what its
 * channel needs, parses to ``null`` and is ignored.
 */

import { PlanTaskList, type PlanTask } from "../chat/planTasks";
import {
  visualizationDeltaFromPayload,
  type VisualizationDeltaEvent,
} from "../chat/visualizationStream";
import {
  emptyWindowState,
  type WindowChange,
  type WindowField,
} from "../clientState";
import {
  PERMISSION_MODE_NAMES,
  type PermissionModeName,
  type PushNotification,
} from "./messages";
import {
  parseOrchestrateEvent,
  type OrchestrateEventEnvelope,
} from "./orchestrateEvents";
import { WirePayload } from "./wirePayload";
import { parseWorkflowEvent, type WorkflowEvent } from "./workflowEvents";

export interface BackgroundProcessDone {
  channel: "background_process_done";
  cmd: string;
  exitCode: number | undefined;
  durationSeconds?: number;
}

export interface SchedulerEvent {
  channel: "scheduler_started" | "scheduler_completed";
  description: string;
  result: string;
  /** Opaque: forwarded back with the native notification's click. */
  taskId: unknown;
}

export interface OpenExternal {
  channel: "open_external";
  window: string;
  url: string;
}

export interface WindowModelChanged {
  channel: "window_model_changed";
  change: WindowChange;
}

export interface FileEdited {
  channel: "file_edited";
}

export type OrchestratePush =
  | {
      channel: "orchestrate_event";
      delta: VisualizationDeltaEvent;
      envelope?: undefined;
    }
  | {
      channel: "orchestrate_event";
      envelope: OrchestrateEventEnvelope;
      delta?: undefined;
    };

export interface WorkflowPush {
  channel: "workflow_event";
  event: WorkflowEvent;
}

export interface OrchestrateProgress {
  channel: "orchestrate_progress";
  line: string;
}

export interface SessionNamed {
  channel: "session_named";
}

export interface PermissionModeChanged {
  channel: "permission_mode_changed";
  mode: PermissionModeName;
  /** ``agent`` when the agent entered the mode itself. */
  source: string;
  reason: string;
}

export interface HttpRetryAttempt {
  channel: "http_retry_attempt";
  attempt?: number;
  delaySeconds?: number;
  url?: string;
}

export interface HttpRetrySucceeded {
  channel: "http_retry_succeeded";
}

export interface PlanSubmitted {
  channel: "plan_submitted";
  plan: string;
  tasks: PlanTask[];
  runId: string;
}

export type PlanDecision = "approved" | "dismissed";

export interface PlanDecided {
  channel: "plan_decided";
  runId: string;
  decision: PlanDecision;
}

export interface TodosUpdated {
  channel: "todos_updated";
  /** The ``todo_write`` snapshot; {@link PlanTaskList.mergeTodos} reads it. */
  todos: unknown;
}

/** A host-model signal an extension's page subscribed to, already
 *  filtered by the backend to the extensions entitled to hear it. */
export interface HostSignal {
  channel: "host_signal";
  extensionId: string;
  signal: string;
  value: unknown;
}

export type PushChannelEvent =
  | BackgroundProcessDone
  | SchedulerEvent
  | OpenExternal
  | WindowModelChanged
  | FileEdited
  | OrchestratePush
  | WorkflowPush
  | OrchestrateProgress
  | SessionNamed
  | PermissionModeChanged
  | HttpRetryAttempt
  | HttpRetrySucceeded
  | PlanSubmitted
  | PlanDecided
  | TodosUpdated
  | HostSignal;

export type PushChannel = PushChannelEvent["channel"];

/** The event a channel carries (one event type may serve two channels). */
export type PushChannelEventOf<K extends PushChannel> =
  PushChannelEvent extends infer E
    ? E extends { channel: infer C }
      ? K extends C
        ? E
        : never
      : never
    : never;

const PLAN_DECISIONS = ["approved", "dismissed"] as const;
const WINDOW_FIELDS = Object.keys(emptyWindowState()) as WindowField[];

type Parsers = {
  [K in PushChannel]: (
    payload: WirePayload,
    raw: unknown,
  ) => PushChannelEventOf<K> | null;
};

const PARSERS: Parsers = {
  background_process_done: (p) => ({
    channel: "background_process_done",
    cmd: p.text("cmd"),
    exitCode: p.optionalNumber("exit_code"),
    durationSeconds: p.optionalNumber("duration_seconds"),
  }),
  scheduler_started: (p) => schedulerEvent("scheduler_started", p),
  scheduler_completed: (p) => schedulerEvent("scheduler_completed", p),
  open_external: (p) => ({
    channel: "open_external",
    window: p.string("window"),
    url: p.text("url"),
  }),
  window_model_changed: (p) => {
    const field = WINDOW_FIELDS.find((f) => f === p.value("field"));
    const rev = p.optionalNumber("rev");
    const window = p.optionalString("window");
    if (!field || rev === undefined || window === undefined) return null;
    const item = p.plainObject("item");
    return {
      channel: "window_model_changed",
      change: {
        window,
        field,
        value: p.value("value"),
        rev,
        token: p.string("token"),
        event: p.optionalString("event"),
        item: item ?? null,
        answer: p.value("answer"),
      },
    };
  },
  file_edited: () => ({ channel: "file_edited" }),
  orchestrate_event: (_p, raw) => {
    const delta = visualizationDeltaFromPayload(raw);
    if (delta) return { channel: "orchestrate_event", delta };
    const envelope = parseOrchestrateEvent(raw);
    return envelope ? { channel: "orchestrate_event", envelope } : null;
  },
  workflow_event: (_p, raw) => {
    const event = parseWorkflowEvent(raw);
    return event ? { channel: "workflow_event", event } : null;
  },
  orchestrate_progress: (p) => {
    const line = p.text("line").trim();
    return line ? { channel: "orchestrate_progress", line } : null;
  },
  session_named: () => ({ channel: "session_named" }),
  permission_mode_changed: (p) => ({
    channel: "permission_mode_changed",
    mode: p.oneOf("mode", PERMISSION_MODE_NAMES, "default"),
    source: p.text("source"),
    reason: p.text("reason").trim(),
  }),
  http_retry_attempt: (p) => ({
    channel: "http_retry_attempt",
    attempt: p.optionalNumber("attempt"),
    delaySeconds: p.optionalNumber("delay_seconds"),
    url: p.optionalString("url"),
  }),
  http_retry_succeeded: () => ({ channel: "http_retry_succeeded" }),
  plan_submitted: (p) => {
    const plan = p.text("plan").trim();
    if (!plan) return null;
    return {
      channel: "plan_submitted",
      plan,
      tasks: PlanTaskList.parse(p.value("tasks")).tasks,
      runId: p.text("run_id"),
    };
  },
  plan_decided: (p) => {
    const runId = p.text("run_id");
    const decision = PLAN_DECISIONS.find((d) => d === p.value("decision"));
    return runId && decision
      ? { channel: "plan_decided", runId, decision }
      : null;
  },
  todos_updated: (p) => ({ channel: "todos_updated", todos: p.value("todos") }),
  host_signal: (p) => {
    const extensionId = p.optionalString("extension_id");
    const signal = p.optionalString("signal");
    if (extensionId === undefined || signal === undefined) return null;
    return {
      channel: "host_signal",
      extensionId,
      signal,
      value: p.value("value"),
    };
  },
};

function schedulerEvent(
  channel: SchedulerEvent["channel"],
  p: WirePayload,
): SchedulerEvent {
  return {
    channel,
    description: p.text("description").trim(),
    result: p.text("result").trim(),
    taskId: p.value("task_id"),
  };
}

function isPushChannel(channel: string): channel is PushChannel {
  return Object.prototype.hasOwnProperty.call(PARSERS, channel);
}

/** The typed event a push carries, or ``null`` for a channel this
 *  client does not act on or a payload its channel cannot use. */
export function parsePushChannel(
  m: Pick<PushNotification, "channel" | "payload">,
): PushChannelEvent | null {
  if (!isPushChannel(m.channel)) return null;
  const parse = PARSERS[m.channel] as (
    payload: WirePayload,
    raw: unknown,
  ) => PushChannelEvent | null;
  return parse(new WirePayload(m.payload), m.payload);
}
