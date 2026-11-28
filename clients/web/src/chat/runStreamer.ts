/**
 * Starts the streams this view drives — a message, a retry, a HITL
 * resume — and owns what every one of them shares: the view-generation
 * guard (events of a run started before ``/clear`` or ``/fork`` are
 * dropped), the phase it settles in, and the after-run tail (status,
 * the reply-ready notice, the next ``/loop`` iteration).
 */

import type { IgniClient } from "../protocol/client";
import type { HITLDecision } from "../protocol/clientMessages";
import type { ServerMessage } from "../protocol/messages";
import { PendingLoopIteration } from "../protocol/rpcResults";
import type { Notifier } from "../notifications/notifier";
import type { RunPhase } from "./runPhase";
import type { ShellPort } from "./shellPort";
import type { TranscriptView } from "./transcriptView";
import type { RunControls } from "./useRunPhase";

type StreamHandler = (m: ServerMessage) => void;

export interface RunStreamerDeps {
  client: Pick<IgniClient, "runMessage" | "resolveHitlBatch" | "rpc">;
  view: TranscriptView;
  run: Pick<RunControls, "setRunPhase" | "runPhaseRef" | "viewGenRef">;
  shell: Pick<ShellPort, "refreshStatus">;
  notifier: Pick<Notifier, "replyReady">;
  /** Where a live event of this view's stream goes. */
  onEvent: StreamHandler;
}

/** How one kind of stream starts and ends. */
interface StreamPlan {
  start: (onEvent: StreamHandler) => Promise<void>;
  /** The phases a stream that ended without a terminal event is still
   *  in; it moves on to ``done`` from them. ``finalizing`` is one: the
   *  backend ends the stream only once the run is over. */
  settlesFrom: readonly RunPhase[];
  /** Aborted when the backend queued the message instead of running it. */
  queued?: AbortSignal;
  onError: (e: unknown) => void;
}

export class RunStreamer {
  constructor(private readonly deps: RunStreamerDeps) {}

  /** The view generation now, for a caller that must snapshot it before
   *  an await (a retry trims the transcript first). */
  generation(): number {
    return this.deps.run.viewGenRef.current;
  }

  /** Send a message as a new run. ``queued`` aborts when the backend
   *  queues it behind a turn still working instead. */
  async send(text: string, queued?: AbortSignal): Promise<void> {
    const { client, run, view } = this.deps;
    run.setRunPhase("starting");
    await this.stream({
      start: (on) => client.runMessage(text, on, undefined, { signal: queued }),
      settlesFrom: ["starting", "streaming", "finalizing"],
      queued,
      onError: (e) => {
        view.error(String(e));
        run.setRunPhase("errored");
        // The trailing reply's Retry / Discard / Edit banner shows now;
        // the backend's own interrupted record surfaces on reload.
        view.update((t) => t.markInterrupted("errored"));
      },
    });
  }

  /** A ``/loop`` iteration: the tidy iteration card, then the wrapped
   *  prompt the model gets. */
  async sendLoopIteration(prompt: string): Promise<void> {
    this.deps.view.append(this.deps.view.chatItems.loop(prompt));
    await this.send(prompt);
  }

  /** Answer the open approvals; the backend's re-emitted run events
   *  drive the rest. */
  async resume(decisions: HITLDecision[]): Promise<void> {
    const { client, run, view } = this.deps;
    run.setRunPhase("streaming");
    await this.stream({
      start: (on) => client.resolveHitlBatch(decisions, on),
      settlesFrom: ["streaming", "finalizing"],
      onError: (e) => {
        view.error(String(e));
        run.setRunPhase("errored");
      },
    });
  }

  /** Re-fire an interrupted prompt with ``force`` (the backend
   *  supersedes the stale interrupted row), routed as of ``generation``. */
  async retry(text: string, generation = this.generation()): Promise<void> {
    try {
      await this.deps.client.runMessage(
        text,
        this.guard(generation),
        undefined,
        { force: true },
      );
    } catch (e) {
      this.deps.view.error(
        `Couldn't retry: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private guard(generation: number): StreamHandler {
    return (m) => {
      if (generation === this.deps.run.viewGenRef.current) this.deps.onEvent(m);
    };
  }

  private async stream(plan: StreamPlan): Promise<void> {
    const { run } = this.deps;
    try {
      await plan.start(this.guard(this.generation()));
      if (plan.queued?.aborted) {
        // A turn works on the backend: its events move the phase on, and
        // the message runs in it or after it. Nothing has replied yet.
        run.setRunPhase("streaming");
        return;
      }
      if (plan.settlesFrom.includes(run.runPhaseRef.current))
        run.setRunPhase("done");
    } catch (e) {
      plan.onError(e);
    }
    this.afterRun();
  }

  /** What follows every run this view drove: status, the reply-ready
   *  notice, the next ``/loop`` iteration. */
  private afterRun(): void {
    void this.deps.shell.refreshStatus(); // keep the ctx counter live after each run
    this.deps.notifier.replyReady();
    void this.continueLoop();
  }

  /** TUI parity: a pending ``/loop`` refires after each run. */
  private async continueLoop(): Promise<void> {
    try {
      const next = PendingLoopIteration.parse(
        await this.deps.client.rpc<unknown>("pop_pending_loop_iteration"),
      );
      if (next.prompt) await this.sendLoopIteration(next.prompt);
    } catch {
      /* no loop pending */
    }
  }
}
