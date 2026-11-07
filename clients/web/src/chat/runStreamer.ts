/**
 * Starts the streams this view drives — a message, a retry, a HITL
 * resume — and owns what every one of them shares: the view-generation
 * guard (events of a run started before ``/clear`` or ``/fork`` are
 * dropped), the phase it settles in, and the after-run tail (status,
 * the reply-ready notice, the next ``/loop`` iteration).
 */

import type { IgniClient } from "../protocol/client";
import type { ServerMessage } from "../protocol/messages";
import { PendingLoopIteration } from "../protocol/rpcResults";
import type { HitlDecision } from "../components/HitlDialog";
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
   *  in; it moves on to ``done`` from them. */
  settlesFrom: readonly RunPhase[];
  onError: (e: unknown) => void;
}

export class RunStreamer {
  constructor(private readonly deps: RunStreamerDeps) {}

  /** The view generation now, for a caller that must snapshot it before
   *  an await (a retry trims the transcript first). */
  generation(): number {
    return this.deps.run.viewGenRef.current;
  }

  /** Send a message as a new run. */
  async send(text: string): Promise<void> {
    const { client, run, view } = this.deps;
    run.setRunPhase("starting");
    await this.stream({
      start: (on) => client.runMessage(text, on),
      settlesFrom: ["starting", "streaming"],
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
  async resume(decisions: HitlDecision[]): Promise<void> {
    const { client, run, view } = this.deps;
    run.setRunPhase("streaming");
    await this.stream({
      start: (on) => client.resolveHitlBatch(decisions, on),
      settlesFrom: ["streaming"],
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
      await this.deps.client.runMessage(text, this.guard(generation), undefined, { force: true });
    } catch (e) {
      this.deps.view.error(`Couldn't retry: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private guard(generation: number): StreamHandler {
    return (m) => {
      if (generation === this.deps.run.viewGenRef.current) this.deps.onEvent(m);
    };
  }

  private async stream(plan: StreamPlan): Promise<void> {
    const { run, shell, notifier } = this.deps;
    try {
      await plan.start(this.guard(this.generation()));
      if (plan.settlesFrom.includes(run.runPhaseRef.current)) run.setRunPhase("done");
    } catch (e) {
      plan.onError(e);
    } finally {
      void shell.refreshStatus(); // keep the ctx counter live after each run
      notifier.replyReady();
      void this.continueLoop();
    }
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
