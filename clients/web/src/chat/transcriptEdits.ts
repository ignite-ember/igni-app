/**
 * Editing the conversation from one of its rows: edit or delete a user
 * message, and the Retry / Discard / Edit banner under an interrupted
 * reply.
 *
 * The banner's three actions start from the user message that triggered
 * the interrupted run and trim from it onward, locally: the backend has
 * the interrupted record but no session entry for it, so
 * ``truncate_history`` would 404.
 */

import type { WindowModel } from "../clientState";
import type { IgniClient } from "../protocol/client";
import { InterruptedRun, TruncateHistoryResult } from "../protocol/rpcResults";
import type { UserItem } from "./chatItem";
import type { RunStreamer } from "./runStreamer";
import type { ShellPort } from "./shellPort";
import type { TranscriptView } from "./transcriptView";

export interface TranscriptEditsDeps {
  client: Pick<IgniClient, "rpc">;
  view: TranscriptView;
  streamer: Pick<RunStreamer, "send" | "retry" | "generation">;
  windowModel: Pick<WindowModel, "get">;
  shell: Pick<ShellPort, "refreshStatus" | "seedComposer">;
}

export class TranscriptEdits {
  constructor(private readonly deps: TranscriptEditsDeps) {}

  readonly deleteUser = async (target: UserItem): Promise<void> => {
    await this.truncateFrom(target);
  };

  /** The typed-submit path again: the new bubble, then the run. */
  readonly editUser = async (target: UserItem, newText: string): Promise<void> => {
    if (!(await this.truncateFrom(target))) return;
    const { view, streamer } = this.deps;
    view.append(view.chatItems.user(newText));
    await streamer.send(newText);
  };

  readonly retryInterrupted = async (assistantItemId: number): Promise<void> => {
    const prompt = this.promptOf(assistantItemId);
    if (!prompt?.runId) return;
    const { view, streamer } = this.deps;
    // Snapshot before the trim, so the new run's events still route to
    // the live list.
    const generation = streamer.generation();
    if (!(await this.truncateFrom(prompt))) return;
    // The socket echo is filtered as this view's own: re-add the bubble.
    view.append(view.chatItems.user(prompt.text));
    await streamer.retry(prompt.text, generation);
  };

  /** The local trim, then ``discard_interrupted_run`` so the durable
   *  record goes too. Either failing leaves the view sane. */
  readonly discardInterrupted = async (assistantItemId: number): Promise<void> => {
    const prompt = this.promptOf(assistantItemId);
    if (!prompt) return;
    await this.truncateFrom(prompt);
    const sessionId = this.deps.windowModel.get("session");
    if (!prompt.runId || !sessionId) return;
    const { client } = this.deps;
    try {
      const runs = InterruptedRun.parseList(
        await client.rpc<unknown>("get_interrupted_runs", { session_id: sessionId }),
      );
      const match = runs.find((r) => r.content === prompt.text);
      if (match) {
        await client.rpc("discard_interrupted_run", {
          session_id: sessionId,
          message_id: match.messageId,
        });
      }
    } catch (e) {
      // Non-fatal: ``detect_interrupted_run`` cleans up next time.
      console.warn("discard_interrupted_run RPC failed", e);
    }
  };

  /** The trim, then the original prompt back in the composer. */
  readonly editPrompt = async (assistantItemId: number): Promise<void> => {
    const prompt = this.promptOf(assistantItemId);
    if (!prompt) return;
    await this.truncateFrom(prompt);
    this.deps.shell.seedComposer(prompt.text);
  };

  private promptOf(assistantItemId: number): UserItem | undefined {
    return this.deps.view.current().precedingUserOf(assistantItemId);
  }

  /** Cut the backend's history at ``target``'s run when it persisted
   *  one, then everything from ``target`` on here. ``false`` when the
   *  backend refused, and nothing was trimmed. */
  private async truncateFrom(target: UserItem): Promise<boolean> {
    const sessionId = this.deps.windowModel.get("session");
    if (!target.runId || !sessionId) return false;
    const { view, client, shell } = this.deps;
    // A run cancelled or errored before it persisted is not in the
    // session: the RPC could only fail.
    if (target.persisted === true) {
      let error = "";
      try {
        error = TruncateHistoryResult.parse(
          await client.rpc<unknown>("truncate_history", { session_id: sessionId, run_id: target.runId }),
        ).error;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      if (error) {
        view.error(`Couldn't edit/delete: ${error}`);
        return false;
      }
    }
    view.edit((items) => {
      const idx = items.findIndex((p) => p.id === target.id);
      return idx === -1 ? items : items.slice(0, idx);
    });
    // The latched context count was for the longer history.
    void shell.refreshStatus();
    return true;
  }
}
