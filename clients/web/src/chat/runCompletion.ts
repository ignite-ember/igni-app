/**
 * What ``run_completed`` does to the transcript: settle the turn's
 * orchestrate card, and add the run's stats line at the end of its turn.
 */

import type { RunCompleted } from "../protocol/messages";
import type { OrchestrateItem, UserItem } from "./chatItem";
import type { ChatTranscript, ItemAt } from "./chatTranscript";

/** Rough chars-to-tokens estimate. A browser tokenizer would cost
 *  ~250KB of bundle for one display string. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
}

/** The text one turn rendered, by kind. */
export interface TurnText {
  thinking: string;
  assistant: string;
}

export class RunCompletion {
  constructor(
    private readonly transcript: ChatTranscript,
    private readonly msg: RunCompleted,
  ) {}

  apply(): ChatTranscript {
    if (this.msg.parent_run_id) return this.transcript;
    const settled = this.settleOrchestrateCard();
    if (!this.msg.input_tokens && !this.msg.output_tokens) return settled;
    const owner = this.ownerUser(settled);
    const turn = this.visibleText(settled, owner?.index ?? -1);
    const stats = settled.factory.stats({
      runId: this.msg.run_id || "",
      inputTokens: this.msg.input_tokens,
      outputTokens: this.msg.output_tokens,
      reasoningTokens: this.msg.reasoning_tokens || 0,
      visibleThinkTokens: estimateTokens(turn.thinking),
      visibleOutTokens: estimateTokens(turn.assistant),
      duration: this.displayDuration(owner?.item),
      corrected: false,
    });
    if (!owner) return settled.append(stats);
    return settled.insertAt(this.insertionIndex(settled, owner.index), stats);
  }

  /** The latest turn's streaming card stops spinning. */
  private settleOrchestrateCard(): ChatTranscript {
    const hit = this.transcript.lastWhere(
      (it): it is OrchestrateItem => it.kind === "orchestrate" && it.streaming,
      true,
    );
    if (!hit) return this.transcript;
    return this.transcript.replaceAt(hit.index, { ...hit.item, streaming: false });
  }

  private ownerUser(transcript: ChatTranscript): ItemAt<UserItem> | null {
    if (!this.msg.run_id) return null;
    return transcript.lastWhere(
      (it): it is UserItem => it.kind === "user" && it.runId === this.msg.run_id,
    );
  }

  /** What the user waited for: run start to the end of the visible
   *  stream. Agno's duration also counts its post-stream tail. */
  private displayDuration(owner: UserItem | undefined): number {
    if (owner?.startedAt && owner.streamingEndedAt) {
      return (owner.streamingEndedAt - owner.startedAt) / 1000;
    }
    return this.msg.duration;
  }

  /** The turn after ``userIdx`` up to the next user message; without
   *  an owner, the turn since the last user message. A late
   *  ``run_completed`` must not count the next turn's reply. */
  private visibleText(transcript: ChatTranscript, userIdx: number): TurnText {
    const items = transcript.items;
    const start =
      userIdx >= 0 ? userIdx + 1 : (transcript.lastWhere((it) => it.kind === "user")?.index ?? -1) + 1;
    const turn: TurnText = { thinking: "", assistant: "" };
    for (const it of items.slice(start)) {
      if (it.kind === "user") break;
      if (it.kind === "thinking") turn.thinking += it.text + " ";
      else if (it.kind === "assistant") turn.assistant += it.text + " ";
    }
    return { thinking: turn.thinking.trim(), assistant: turn.assistant.trim() };
  }

  /** Just before the next user message, so a fast follow-up's reply
   *  does not land above this run's stats. */
  private insertionIndex(transcript: ChatTranscript, userIdx: number): number {
    const next = transcript.items.findIndex((it, i) => i > userIdx && it.kind === "user");
    return next < 0 ? transcript.items.length : next;
  }
}
