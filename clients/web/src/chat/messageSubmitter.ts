/**
 * What the composer's Send does with a line: a slash command, a ``$``
 * shell line, or a message — queued behind a run in flight, and resumed
 * from an interrupted reply's partial when there is one.
 */

import type { IgniClient } from "../protocol/client";
import { buildContinuedPrompt } from "./continueInterrupted";
import { QUEUED_NOTE } from "./mirrorEventRouter";
import type { RunStreamer } from "./runStreamer";
import { isProcessing } from "./runPhase";
import type { SlashCommandRouter } from "./slashCommandRouter";
import type { TranscriptView } from "./transcriptView";
import type { RunControls } from "./useRunPhase";

export interface MessageSubmitterDeps {
  client: Pick<IgniClient, "runShell" | "queueMessage">;
  view: TranscriptView;
  run: Pick<RunControls, "runPhaseRef">;
  commands: Pick<SlashCommandRouter, "run">;
  streamer: Pick<RunStreamer, "send">;
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
      const res = await client.runShell(command);
      view.edit((items) =>
        items.map((it) =>
          it.id === item.id && it.kind === "shell"
            ? { ...it, output: res.output, exitCode: res.exit_code }
            : it,
        ),
      );
    } catch (e) {
      view.error(String(e));
    }
  }

  /** After an interrupted reply, any new message (even a bare
   *  ``continue``) resumes from the partial: the backend gets a fenced
   *  context block, the bubble shows what was typed. */
  private async sendMessage(text: string): Promise<void> {
    const { client, view, run, streamer } = this.deps;
    view.append(view.chatItems.user(text));
    if (isProcessing(run.runPhaseRef.current)) {
      client.queueMessage(text);
      view.info(QUEUED_NOTE);
      return;
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
    await streamer.send(continued.text);
  }
}
