/**
 * Folds one streamed run event into the transcript.
 */

import type {
  ContentDelta,
  ErrorMessage,
  Info,
  RunError,
  RunStarted,
  ServerMessage,
  StreamingDone,
  ToolCompleted,
  ToolError,
  ToolStarted,
} from "../protocol/messages";
import type { ChatItem, ToolItem, UserItem } from "./chatItem";
import type { ChatTranscript } from "./chatTranscript";
import { RunCompletion } from "./runCompletion";

/** A message type with no handler (``model_completed`` among them:
 *  per-step totals re-count the whole context) leaves the transcript
 *  as it is. */
type Handlers = {
  [K in ServerMessage["type"]]?: (msg: Extract<ServerMessage, { type: K }>) => ChatTranscript;
};

const isRunningTool = (it: ChatItem): it is ToolItem =>
  it.kind === "tool" && it.status === "running";

export class ServerMessageReducer {
  private readonly handlers: Handlers = {
    content_delta: (msg) => this.onContentDelta(msg),
    tool_started: (msg) => this.onToolStarted(msg),
    tool_completed: (msg) => this.onToolCompleted(msg),
    tool_error: (msg) => this.onToolError(msg),
    run_started: (msg) => this.onRunStarted(msg),
    streaming_done: (msg) => this.onStreamingDone(msg),
    run_completed: (msg) => new RunCompletion(this.transcript, msg).apply(),
    run_error: (msg) => this.onRunError(msg),
    info: (msg) => this.onInfo(msg),
    error: (msg) => this.onError(msg),
  };

  constructor(private readonly transcript: ChatTranscript) {}

  apply(msg: ServerMessage): ChatTranscript {
    const handle = this.handlers[msg.type] as ((msg: ServerMessage) => ChatTranscript) | undefined;
    return handle ? handle(msg) : this.transcript;
  }

  /** The BE has already split think tags out; route by its flag. */
  private onContentDelta(msg: ContentDelta): ChatTranscript {
    return this.transcript.appendText(msg.text, !!msg.is_thinking);
  }

  private onToolStarted(msg: ToolStarted): ChatTranscript {
    return this.transcript.append(this.transcript.factory.runningTool(msg));
  }

  private onToolCompleted(msg: ToolCompleted): ChatTranscript {
    const hit = this.transcript.lastWhere(isRunningTool);
    if (!hit) return this.transcript;
    return this.transcript.replaceAt(hit.index, {
      ...hit.item,
      status: msg.is_rejected ? "rejected" : msg.is_error ? "error" : "done",
      result: msg.full_result || msg.summary,
      isError: msg.is_error,
      diffRows: msg.diff_rows ?? null,
    });
  }

  private onToolError(msg: ToolError): ChatTranscript {
    const hit = this.transcript.lastWhere(isRunningTool);
    if (!hit) return this.transcript.append(this.transcript.factory.error(msg.error));
    return this.transcript.replaceAt(hit.index, {
      ...hit.item,
      status: "error",
      result: msg.error,
      isError: true,
    });
  }

  /** A sub-agent run gets an inline marker unless a live orchestrate
   *  card already shows it. A top-level run stamps its id and start
   *  time on the user message that has none yet. */
  private onRunStarted(msg: RunStarted): ChatTranscript {
    const t = this.transcript;
    if (msg.parent_run_id) {
      const last = t.items.at(-1);
      if (last?.kind === "orchestrate" && last.streaming) return t;
      return t.append(t.factory.agent(msg.agent_name));
    }
    if (!msg.run_id) return t;
    const hit = t.lastWhere((it): it is UserItem => it.kind === "user" && !it.runId, true);
    if (!hit) return t;
    return t.replaceAt(hit.index, { ...hit.item, runId: msg.run_id, startedAt: Date.now() });
  }

  private onStreamingDone(msg: StreamingDone): ChatTranscript {
    if (!msg.run_id) return this.transcript;
    const hit = this.transcript.lastWhere(
      (it): it is UserItem => it.kind === "user" && it.runId === msg.run_id,
    );
    if (!hit) return this.transcript;
    return this.transcript.replaceAt(hit.index, { ...hit.item, streamingEndedAt: Date.now() });
  }

  private onRunError(msg: RunError): ChatTranscript {
    return this.transcript.append(this.transcript.factory.error(msg.error));
  }

  private onInfo(msg: Info): ChatTranscript {
    return this.transcript.append(this.transcript.factory.info(msg.text));
  }

  private onError(msg: ErrorMessage): ChatTranscript {
    return this.transcript.append(this.transcript.factory.error(msg.text));
  }
}
