/**
 * Acts on one event of a stream this view started (a run, a HITL
 * resume): one method per event type that needs more than rendering,
 * picked from a table. Everything else is rendered into the transcript.
 *
 * Built once per window from collaborators that never change, so the
 * stream callbacks that reach it can never see a stale value.
 */

import type { IgniClient } from "../protocol/client";
import type { CommandResult, RunCompleted, RunStarted, ServerMessage } from "../protocol/messages";
import { ContextTokenCount } from "../protocol/rpcResults";
import type { HitlRequests } from "./hitlRequests";
import type { ShellPort } from "./shellPort";
import type { TranscriptView } from "./transcriptView";
import type { RunControls } from "./useRunPhase";

export interface StreamEventRouterDeps {
  client: Pick<IgniClient, "rpc">;
  view: TranscriptView;
  hitl: HitlRequests;
  run: Pick<RunControls, "setRunPhase" | "autoAcceptForRunRef">;
  shell: Pick<ShellPort, "setStatus" | "refreshStatus" | "refreshSessions">;
  /** Turn acceptEdits back off, silently (no typed command in the chat). */
  revertAutoAccept: () => void;
}

type ServerMessageType = ServerMessage["type"];
type StreamRoutes = {
  [K in ServerMessageType]?: (m: Extract<ServerMessage, { type: K }>) => void;
};

export class StreamEventRouter {
  private readonly routes: StreamRoutes = {
    streaming_done: () => this.onContentDone(),
    run_paused: (m) => this.deps.hitl.show(m.requirements),
    // On the run stream, where the safety check's question was raised.
    requirement_details: (m) => this.deps.hitl.addDetails(m),
    status_update: (m) => this.deps.shell.setStatus(m),
    command_result: (m) => this.onCommandResult(m),
    run_started: (m) => this.onRunStarted(m),
    run_completed: (m) => this.onRunCompleted(m),
  };

  constructor(private readonly deps: StreamEventRouterDeps) {}

  route(m: ServerMessage): void {
    const handler = this.routes[m.type] as ((m: ServerMessage) => void) | undefined;
    if (handler) handler(m);
    else this.deps.view.apply(m);
  }

  /** Content has ended; the backend's tail (memory, compression) still
   *  drains, which ``finalizing`` keeps the indicator up through. */
  private onContentDone(): void {
    this.deps.run.setRunPhase("finalizing");
    const autoAccept = this.deps.run.autoAcceptForRunRef;
    if (autoAccept.current) {
      autoAccept.current = false;
      this.deps.revertAutoAccept();
    }
  }

  private onCommandResult(m: CommandResult): void {
    const text = m.display_content || m.content;
    if (!text) return;
    const { view } = this.deps;
    view.append(m.kind === "error" ? view.chatItems.error(text) : view.chatItems.assistant(text));
  }

  /** The backend confirmed the run is live. */
  private onRunStarted(m: RunStarted): void {
    this.deps.run.setRunPhase("streaming");
    this.deps.view.apply(m);
  }

  private onRunCompleted(m: RunCompleted): void {
    this.deps.view.apply(m);
    if (m.parent_run_id || !m.run_id) return;
    const runId = m.run_id;
    // The terminal transition, even from ``finalizing``.
    this.deps.run.setRunPhase("done");
    // Persisted now: an edit or delete of its user message truncates
    // the backend's copy instead of trimming locally.
    this.deps.view.update((t) => t.markRunPersisted(runId));
    // The session row exists from the first message on, so a new
    // session appears in ``list_sessions`` only now.
    void this.deps.shell.refreshSessions();
    void this.correctStats(runId);
  }

  /** Agno's ``input_tokens`` sums every model iteration, 2-3x the real
   *  session on multi-step turns; the stats line gets the real count. */
  private async correctStats(runId: string): Promise<void> {
    let ctx = 0;
    try {
      ctx = ContextTokenCount.parse(await this.deps.client.rpc<unknown>("count_context_tokens"));
    } catch {
      return; // the un-corrected number beats none
    }
    if (!ctx) return;
    this.deps.view.update((t) => t.correctStats(runId, ctx));
    // The same RPC latched the count into the backend: show it now.
    void this.deps.shell.refreshStatus();
  }
}
