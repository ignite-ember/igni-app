/**
 * Acts on a typed ``push_notification``: one method per channel, picked
 * from a table rather than an if-chain.
 *
 * Built once per window from dependencies that never change — setters,
 * the window model, the item factory — so the socket listener that
 * calls it, mounted once, can never reach a stale value through it.
 */

import type { Dispatch, SetStateAction } from "react";

import type { WindowModel } from "../clientState";
import type { Host } from "../lib/host";
import type { Notifier } from "../notifications/notifier";
import { PushNotice } from "../notifications/pushNotice";
import type { StatusUpdate } from "../protocol/messages";
import type { OrchestrateEventEnvelope } from "../protocol/orchestrateEvents";
import type {
  BackgroundProcessDone,
  HttpRetryAttempt,
  OpenExternal,
  OrchestrateProgress,
  OrchestratePush,
  PermissionModeChanged,
  PlanDecided,
  PlanSubmitted,
  PushChannel,
  PushChannelEvent,
  PushChannelEventOf,
  SchedulerEvent,
  TodosUpdated,
  WindowModelChanged,
  WorkflowPush,
} from "../protocol/pushChannels";
import type { ChatItem } from "./chatItem";
import type { ChatItemFactory } from "./chatItemFactory";
import type { ChatTranscript } from "./chatTranscript";
import { HttpRetryAttemptEvent, HttpRetrySucceededEvent } from "./httpRetryEvents";
import { PlanTaskList } from "./planTasks";
import { applyVisualizationDelta } from "./visualizationStream";

/** How much of a legacy progress line lands in the card. */
export const PROGRESS_LINE_CHARS = 120;

export interface PushChannelRouterDeps {
  windowModel: Pick<WindowModel, "clientId" | "applyPush">;
  chatItems: ChatItemFactory;
  transcript: (items: ChatItem[]) => ChatTranscript;
  setItems: Dispatch<SetStateAction<ChatItem[]>>;
  setStatus: Dispatch<SetStateAction<StatusUpdate | null>>;
  notifier: Pick<Notifier, "notify">;
  host: Pick<Host, "openExternal">;
  refreshSessions: () => Promise<void>;
  /** Where the retry banner's events are dispatched. */
  events: Pick<EventTarget, "dispatchEvent">;
}

type Routes = { [K in PushChannel]: (ev: PushChannelEventOf<K>) => void };

export class PushChannelRouter {
  private readonly routes: Routes = {
    background_process_done: (ev) => this.onBackgroundProcessDone(ev),
    scheduler_started: (ev) => this.onSchedulerEvent(ev),
    scheduler_completed: (ev) => this.onSchedulerEvent(ev),
    open_external: (ev) => this.onOpenExternal(ev),
    window_model_changed: (ev) => this.onWindowModelChanged(ev),
    // Neither client holds an editor buffer to refresh.
    file_edited: () => {},
    orchestrate_event: (ev) => this.onOrchestrateEvent(ev),
    workflow_event: (ev) => this.onWorkflowEvent(ev),
    orchestrate_progress: (ev) => this.onOrchestrateProgress(ev),
    session_named: () => this.onSessionNamed(),
    permission_mode_changed: (ev) => this.onPermissionModeChanged(ev),
    http_retry_attempt: (ev) => this.onHttpRetryAttempt(ev),
    http_retry_succeeded: () => this.onHttpRetrySucceeded(),
    plan_submitted: (ev) => this.onPlanSubmitted(ev),
    plan_decided: (ev) => this.onPlanDecided(ev),
    todos_updated: (ev) => this.onTodosUpdated(ev),
    // Addressed to extensions' frames, which hear it through useExtensionTraffic.
    host_signal: () => {},
  };

  constructor(private readonly deps: PushChannelRouterDeps) {}

  route(ev: PushChannelEvent): void {
    (this.routes[ev.channel] as (ev: PushChannelEvent) => void)(ev);
  }

  /** Finished processes are not tied to a place in the conversation,
   *  so they are notified rather than written between chat turns. */
  private onBackgroundProcessDone(ev: BackgroundProcessDone): void {
    void this.deps.notifier.notify(PushNotice.backgroundProcessDone(ev).toNotify());
  }

  /** Scheduled tasks belong to the project, not to whichever chat is open. */
  private onSchedulerEvent(ev: SchedulerEvent): void {
    void this.deps.notifier.notify(PushNotice.scheduler(ev).toNotify());
  }

  /** An extension asked this window to open a link; the backend checked
   *  it, and ``openExternal`` checks it again. */
  private onOpenExternal(ev: OpenExternal): void {
    if (ev.window === this.deps.windowModel.clientId) void this.deps.host.openExternal(ev.url);
  }

  private onWindowModelChanged(ev: WindowModelChanged): void {
    this.deps.windowModel.applyPush(ev.change);
  }

  /** A visualizer card filling in, or a tree event routed to its card. */
  private onOrchestrateEvent(ev: OrchestratePush): void {
    const { chatItems, setItems } = this.deps;
    if (ev.delta) {
      const delta = ev.delta;
      setItems((prev) => applyVisualizationDelta(prev, delta, chatItems));
      return;
    }
    this.applyEnvelope(ev.envelope);
  }

  /** Folded into its run's card by ``workflow_run_id``. */
  private onWorkflowEvent(ev: WorkflowPush): void {
    const { transcript, setItems } = this.deps;
    setItems((prev) => transcript(prev).applyWorkflowEvent(ev.event).items);
  }

  /** The legacy text channel: a preview line for the root agent of the
   *  most recent active card. */
  private onOrchestrateProgress(ev: OrchestrateProgress): void {
    this.applyEnvelope({
      cardId: "",
      event: {
        type: "content_preview",
        agent_path: "root",
        text: ev.line.slice(0, PROGRESS_LINE_CHARS),
      },
    });
  }

  private onSessionNamed(): void {
    void this.deps.refreshSessions();
  }

  /** Patches the cached status so the badge moves without waiting for
   *  the next status push. When the agent itself entered plan mode, the
   *  chat says so and why. */
  private onPermissionModeChanged(ev: PermissionModeChanged): void {
    const { setStatus, setItems, chatItems } = this.deps;
    setStatus((prev) => (prev ? { ...prev, permission_mode: ev.mode } : prev));
    if (ev.source === "agent" && ev.mode === "plan") {
      const text = ev.reason ? `Agent entered plan mode — ${ev.reason}` : "Agent entered plan mode.";
      const item = chatItems.info(text);
      setItems((prev) => [...prev, item]);
    }
  }

  private onHttpRetryAttempt(ev: HttpRetryAttempt): void {
    this.deps.events.dispatchEvent(new HttpRetryAttemptEvent(ev));
  }

  private onHttpRetrySucceeded(): void {
    this.deps.events.dispatchEvent(new HttpRetrySucceededEvent());
  }

  /** The agent's ``exit_plan_mode``: a plan card with Approve / Refine. */
  private onPlanSubmitted(ev: PlanSubmitted): void {
    const item = this.deps.chatItems.plan({ plan: ev.plan, tasks: ev.tasks, runId: ev.runId });
    this.deps.setItems((prev) => [...prev, item]);
  }

  /** The persisted decision, flipped on the card with that run id. */
  private onPlanDecided(ev: PlanDecided): void {
    this.deps.setItems((prev) =>
      prev.map((it) => (it.kind === "plan" && it.runId === ev.runId ? { ...it, state: ev.decision } : it)),
    );
  }

  /** ``todo_write`` moved: every open plan card's checklist follows. */
  private onTodosUpdated(ev: TodosUpdated): void {
    this.deps.setItems((prev) =>
      prev.map((it) =>
        it.kind === "plan" ? { ...it, tasks: new PlanTaskList(it.tasks).mergeTodos(ev.todos).tasks } : it,
      ),
    );
  }

  private applyEnvelope(envelope: OrchestrateEventEnvelope): void {
    const { transcript, setItems } = this.deps;
    setItems((prev) => transcript(prev).applyOrchestrateEvent(envelope).items);
  }
}
