/**
 * What the composer's Send does with a line: a slash command, a ``$``
 * shell line, or a message — queued behind a run in flight, and resumed
 * from an interrupted reply's partial when there is one.
 */

import type { BackendCalls } from "../protocol/backendCalls";
import type { IgniClient } from "../protocol/client";
import { buildContinuedPrompt } from "./continueInterrupted";
import { QUEUED_NOTE } from "./mirrorEventRouter";
import type { RunStreamer } from "./runStreamer";
import { isTurnWorking } from "./runPhase";
import type { SentMessages } from "./sentMessages";
import type { SlashCommandRouter } from "./slashCommandRouter";
import type { TranscriptView } from "./transcriptView";
import type { RunControls } from "./useRunPhase";

export interface MessageSubmitterDeps {
  client: Pick<IgniClient, "queueMessage"> & { calls: Pick<BackendCalls, "runShell"> };
  view: TranscriptView;
  run: Pick<RunControls, "runPhaseRef">;
  commands: Pick<SlashCommandRouter, "run">;
  streamer: Pick<RunStreamer, "send">;
  sent: Pick<SentMessages, "track" | "forget">;
}

export class MessageSubmitter {
  constructor(private readonly deps: MessageSubmitterDeps) {}

  async submit(text: string): Promise<void> {
    if (text.startsWith("/")) await this.deps.commands.run(text);
    else if (text.startsWith("$")) await this.runShell(text.slice(1).trim());
    else await this.sendMessage(text);
  }

  private async runShell(command: string): Promise<void> {
    const { client, view } = this.deps;
    const item = view.chatItems.shell(command);
    view.append(item);
    try {
      const res = await client.calls.runShell(command);
      view.edit((items) =>
        items.map((it) =>
          it.id === item.id && it.kind === "shell"
            ? { ...it, output: res.output, exitCode: res.exitCode }
            : it,
        ),
      );
    } catch (e) {
      view.error(String(e));
    }
  }

  /** A message while a turn works is queued for it — between the turn's
   *  steps too, and in a turn resumed after an approval. One while the
   *  turn waits on an approval goes as a run: it ends that turn. */
  private async sendMessage(text: string): Promise<void> {
    if (isTurnWorking(this.deps.run.runPhaseRef.current)) this.queue(text);
    else await this.startRun(text);
  }

  /** Below the running reply until the turn takes it in (R645). */
  private queue(text: string): void {
    const { client, view } = this.deps;
    view.append(view.chatItems.queuedUser(text));
    view.append(view.chatItems.queuedNote(QUEUED_NOTE));
    client.queueMessage(text);
  }

  /** After an interrupted reply, any new message (even a bare
   *  ``continue``) resumes from the partial: the backend gets a fenced
   *  context block, the bubble shows what was typed. */
  private async startRun(text: string): Promise<void> {
    const { view, streamer, sent } = this.deps;
    // Nothing runs now, so nothing is still waiting its turn.
    view.update((t) => t.settleQueued());
    const bubble = view.chatItems.user(text);
    view.append(bubble);
    // A new message is the person going on past a crash: the
    // restored prompts' banner has done its job.
    if (view.current().items.some((it) => it.kind === "assistant" && it.restored)) {
      view.edit((items) => items.filter((it) => !(it.kind === "assistant" && it.restored)));
    }
    const continued = buildContinuedPrompt(view.current().items, text);
    if (continued.clearIndex >= 0) {
      // The consumed partial is not prepended twice.
      view.edit((items) =>
        items.map((it, i) =>
          i === continued.clearIndex && it.kind === "assistant" && it.interrupted
            ? { ...it, interrupted: undefined }
            : it,
        ),
      );
    }
    // The backend may still queue it, when a turn it knows of works.
    const queued = sent.track(continued.text, bubble.id);
    try {
      await streamer.send(continued.text, queued);
    } finally {
      sent.forget(bubble.id);
    }
  }
}
