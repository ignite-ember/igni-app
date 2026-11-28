/**
 * The messages this view sent as runs that the backend has not said
 * what it did with yet. The backend echoes each one
 * (``user_message_received``): ``queued: false`` when it runs it, and
 * ``queued: true`` when a turn was still working and it queued the
 * message for that turn instead. A queued one's bubble joins the queued
 * tail, and the stream waiting for its run ends: none will come under it.
 */

import type { UserMessageReceived } from "../protocol/messages";
import { QUEUED_NOTE } from "./mirrorEventRouter";
import type { TranscriptView } from "./transcriptView";

interface SentMessage {
  /** What went over the wire, which the echo repeats. */
  text: string;
  bubbleId: number;
  queued: AbortController;
}

export class SentMessages {
  private readonly unanswered: SentMessage[] = [];

  constructor(private readonly view: TranscriptView) {}

  /** ``text`` went out as a run, painted as ``bubbleId``. The signal
   *  aborts if the backend queues it. */
  track(text: string, bubbleId: number): AbortSignal {
    const queued = new AbortController();
    this.unanswered.push({ text, bubbleId, queued });
    return queued.signal;
  }

  /** Its stream ended: nothing is left to answer. */
  forget(bubbleId: number): void {
    const at = this.unanswered.findIndex((s) => s.bubbleId === bubbleId);
    if (at >= 0) this.unanswered.splice(at, 1);
  }

  /** This view's own echo. The oldest unanswered message with its text
   *  is the one answered: echoes come in the order the messages went. */
  echoed(m: UserMessageReceived): void {
    const at = this.unanswered.findIndex((s) => s.text === m.text);
    if (at < 0) return;
    const [sent] = this.unanswered.splice(at, 1);
    if (!m.queued) return;
    this.view.update((t) => t.requeue(sent.bubbleId, QUEUED_NOTE));
    sent.queued.abort();
  }
}
