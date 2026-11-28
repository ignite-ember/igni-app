/**
 * Acts on a broadcast: what other views of this session did, the
 * backend's pushes, and the events of runs this view did not start.
 * One method per event type that needs more than the observer path,
 * picked from a table.
 *
 * The observer path is the cross-view busy indicator plus rendering.
 * Its state machine — including the ``stream_end`` that fires after
 * ``run_completed`` and must not re-arm finalizing — is
 * ``observerBusy.ts``; this adapts the phase to its
 * ``{proc, finalizing}`` shape and back.
 */

import type { IgniClient } from "../protocol/client";
import type {
  PushNotification,
  RequirementResolved,
  RunPaused,
  RunStarted,
  ServerMessage,
  UserMessageReceived,
} from "../protocol/messages";
import { parsePushChannel } from "../protocol/pushChannels";
import { nextObserverBusyState } from "./observerBusy";
import type { HitlRequests } from "./hitlRequests";
import type { PushChannelRouter } from "./pushChannelRouter";
import { phaseFromProcFinalizing, phaseToProcFinalizing } from "./runPhase";
import type { SentMessages } from "./sentMessages";
import type { ShellPort } from "./shellPort";
import type { TranscriptView } from "./transcriptView";
import type { RunControls } from "./useRunPhase";

export const QUEUED_NOTE = "Queued — will run after the current turn.";

export interface MirrorEventRouterDeps {
  client: Pick<IgniClient, "clientId">;
  view: TranscriptView;
  hitl: HitlRequests;
  run: Pick<RunControls, "runPhaseRef" | "setRunPhase">;
  shell: Pick<ShellPort, "setStatus">;
  pushRouter: Pick<PushChannelRouter, "route">;
  sent: Pick<SentMessages, "echoed">;
}

type MirrorRoutes = {
  [K in ServerMessage["type"]]?: (m: Extract<ServerMessage, { type: K }>) => void;
};

export class MirrorEventRouter {
  private readonly routes: MirrorRoutes = {
    // The client stored its id already.
    welcome: () => {},
    // No remote-typing indicator.
    typing: () => {},
    user_message_received: (m) => this.onUserMessage(m),
    requirement_resolved: (m) => this.onResolved(m),
    requirement_details: (m) => this.deps.hitl.addDetails(m),
    run_paused: (m) => this.onPaused(m),
    run_started: (m) => this.onRunStarted(m),
    status_update: (m) => this.deps.shell.setStatus(m),
    push_notification: (m) => this.onPush(m),
  };

  constructor(private readonly deps: MirrorEventRouterDeps) {}

  route(m: ServerMessage): void {
    const handler = this.routes[m.type] as ((m: ServerMessage) => void) | undefined;
    if (handler) handler(m);
    else this.observe(m);
  }

  /** An extension's message (``host.chat.post``) is nobody's echo: every
   *  view paints it, labelled as the extension's. Another view's message
   *  is painted here; this view's own was painted on submit, and its echo
   *  says whether the backend ran it or queued it. */
  private onUserMessage(m: UserMessageReceived): void {
    const { view, client } = this.deps;
    if (!m.extension_id && m.client_id === client.clientId) {
      this.deps.sent.echoed(m);
      return;
    }
    const ext = m.extension_id || undefined;
    if (m.queued) {
      view.append(view.chatItems.queuedUser(m.text, ext));
      view.append(view.chatItems.queuedNote(QUEUED_NOTE));
    } else {
      // It runs now, so nothing is still waiting its turn.
      view.update((t) => t.settleQueued());
      view.append(view.chatItems.user(m.text, ext));
    }
  }

  /** A run of this session paused on an approval — this view's after a
   *  reload (the attach re-sends the pause), or another view's. */
  private onPaused(m: RunPaused): void {
    this.deps.hitl.show(m.requirements);
    this.deps.run.setRunPhase("awaiting_approval");
  }

  /** Another view answered: once nothing is left to answer, the run
   *  resumes on that answer and this view follows it as busy. */
  private onResolved(m: RequirementResolved): void {
    const { hitl, run } = this.deps;
    hitl.resolved(m.requirement_id);
    if (!hitl.open && run.runPhaseRef.current === "awaiting_approval") run.setRunPhase("streaming");
  }

  /** A top-level run starting drops every approval left waiting (a new
   *  message closes the paused run first), so a dialog still open here
   *  is stale: its answers would fail with "Unknown requirement". */
  private onRunStarted(m: RunStarted): void {
    if (!m.parent_run_id) this.deps.hitl.clear();
    this.observe(m);
  }

  private onPush(m: PushNotification): void {
    const ev = parsePushChannel(m);
    if (ev) this.deps.pushRouter.route(ev);
  }

  private observe(m: ServerMessage): void {
    const { run, view } = this.deps;
    const prev = phaseToProcFinalizing(run.runPhaseRef.current);
    run.setRunPhase(phaseFromProcFinalizing(nextObserverBusyState(prev, m), run.runPhaseRef.current));
    // Rendering is orthogonal to the busy indicator — always applied,
    // except for the terminators that carry nothing.
    if (m.type !== "streaming_done" && m.type !== "stream_end") view.apply(m);
  }
}
