/**
 * The conversation's item list, as an immutable value.
 *
 * Every method returns a new transcript, or ``this`` when nothing
 * changed, so ``setItems((prev) => transcript(prev).x().items)`` hands
 * React the same array and it skips the re-render.
 */

import type { ServerMessage } from "../protocol/messages";
import type { OrchestrateEventEnvelope } from "../protocol/orchestrateEvents";
import type { WorkflowEvent } from "../protocol/workflowEvents";
import type { AssistantInterrupted, ChatItem, OrchestrateItem, UserItem } from "./chatItem";
import type { ChatItemFactory } from "./chatItemFactory";
import { OrchestrateAgentTree } from "./orchestrateAgentTree";
import { ServerMessageReducer } from "./serverMessageReducer";
import { WorkflowRunModel } from "./workflowRun";

export interface ItemAt<T extends ChatItem> {
  index: number;
  item: T;
}

export class ChatTranscript {
  constructor(
    readonly items: ChatItem[],
    readonly factory: ChatItemFactory,
  ) {}

  /** Stream text into the open bubble of its kind, or open one. */
  appendText(text: string, thinking: boolean): ChatTranscript {
    if (!text) return this;
    const last = this.items.at(-1);
    if (thinking && last?.kind === "thinking") {
      return this.replaceAt(this.items.length - 1, { ...last, text: last.text + text });
    }
    if (!thinking && last?.kind === "assistant") {
      return this.replaceAt(this.items.length - 1, { ...last, text: last.text + text });
    }
    return this.append(thinking ? this.factory.thinking(text) : this.factory.assistant(text));
  }

  /** The BE persisted ``runId``: its user message can be truncated
   *  server-side. Only the latest turn is searched. */
  markRunPersisted(runId: string): ChatTranscript {
    const hit = this.lastWhere(
      (it): it is UserItem => it.kind === "user" && it.runId === runId && !it.persisted,
      true,
    );
    return hit ? this.replaceAt(hit.index, { ...hit.item, persisted: true }) : this;
  }

  /** Stamp the latest turn's assistant bubble, walking past the tool,
   *  thinking and agent items a stream can end on. */
  markInterrupted(reason: AssistantInterrupted): ChatTranscript {
    const hit = this.lastWhere((it) => it.kind === "assistant", true);
    if (!hit || hit.item.kind !== "assistant" || hit.item.interrupted === reason) return this;
    return this.replaceAt(hit.index, { ...hit.item, interrupted: reason });
  }

  /** The user message that started the run ``itemId`` belongs to. */
  precedingUserOf(itemId: number): UserItem | undefined {
    const target = this.lastWhere((it) => it.id === itemId);
    if (!target) return undefined;
    for (let i = target.index - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.kind === "user") return it;
    }
    return undefined;
  }

  /** The assistant text that closes the turn the ``stats`` item at
   *  ``index`` belongs to — what its copy-response button copies.
   *  Stops at the turn's user message. */
  assistantTextForStats(index: number): string | undefined {
    if (this.items[index]?.kind !== "stats") return undefined;
    for (let i = index - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.kind === "user") return undefined;
      if (it.kind === "assistant") return it.text;
    }
    return undefined;
  }

  /** Replace a run's billed input with the real session size. */
  correctStats(runId: string, contextTokens: number): ChatTranscript {
    if (!this.items.some((it) => it.kind === "stats" && it.runId === runId)) return this;
    return this.with(
      this.items.map((it) =>
        it.kind === "stats" && it.runId === runId
          ? { ...it, inputTokens: contextTokens, corrected: true }
          : it,
      ),
    );
  }

  applyServerMessage(msg: ServerMessage): ChatTranscript {
    return new ServerMessageReducer(this).apply(msg);
  }

  /** The card for a run ``run_workflow`` just started — unless its
   *  first event got here first and already opened it. */
  startWorkflow(name: string, workflowRunId: string): ChatTranscript {
    const open = this.items.some(
      (it) => it.kind === "workflow" && it.run.workflowRunId === workflowRunId,
    );
    return open ? this : this.append(this.factory.workflow(name, workflowRunId));
  }

  /** Fold into the run's card, opening one when this is the first
   *  event seen for it (a reload can race the optimistic card). */
  applyWorkflowEvent(ev: WorkflowEvent): ChatTranscript {
    const at = this.items.findIndex(
      (it) => it.kind === "workflow" && it.run.workflowRunId === ev.workflow_run_id,
    );
    const card = at >= 0 ? this.items[at] : this.factory.workflow(ev.name, ev.workflow_run_id, ev.ts);
    if (card.kind !== "workflow") return this;
    const next = { ...card, run: new WorkflowRunModel(card.run).apply(ev).state };
    return at >= 0 ? this.replaceAt(at, next) : this.append(next);
  }

  /** Fold into the card the envelope names, or the last active card
   *  when it names none; otherwise open a card. */
  applyOrchestrateEvent(envelope: OrchestrateEventEnvelope): ChatTranscript {
    const ids = this.factory.ids;
    const hit = this.orchestrateCard(envelope.cardId);
    if (!hit) {
      const tree = OrchestrateAgentTree.empty(ids).apply(envelope.event);
      return this.append(this.factory.orchestrate(envelope.cardId, tree));
    }
    const tree = OrchestrateAgentTree.of(hit.item, ids);
    const next = tree.apply(envelope.event);
    if (next === tree) return this;
    return this.replaceAt(hit.index, { ...hit.item, agents: next.agents, order: next.order });
  }

  replaceAt(index: number, item: ChatItem): ChatTranscript {
    const items = this.items.slice();
    items[index] = item;
    return this.with(items);
  }

  append(item: ChatItem): ChatTranscript {
    return this.with([...this.items, item]);
  }

  insertAt(index: number, item: ChatItem): ChatTranscript {
    return this.with([...this.items.slice(0, index), item, ...this.items.slice(index)]);
  }

  /** The last item matching ``pred``. With ``stopAtUser`` the search
   *  ends at the first user message that does not match: the latest
   *  turn only. */
  lastWhere<T extends ChatItem>(
    pred: (it: ChatItem) => it is T,
    stopAtUser?: boolean,
  ): ItemAt<T> | null;
  lastWhere(pred: (it: ChatItem) => boolean, stopAtUser?: boolean): ItemAt<ChatItem> | null;
  lastWhere(pred: (it: ChatItem) => boolean, stopAtUser = false): ItemAt<ChatItem> | null {
    for (let index = this.items.length - 1; index >= 0; index--) {
      const item = this.items[index];
      if (pred(item)) return { index, item };
      if (stopAtUser && item.kind === "user") return null;
    }
    return null;
  }

  private orchestrateCard(cardId: string): ItemAt<OrchestrateItem> | null {
    const ids = this.factory.ids;
    if (!cardId) {
      return this.lastWhere(
        (it): it is OrchestrateItem =>
          it.kind === "orchestrate" && OrchestrateAgentTree.of(it, ids).isActive(),
      );
    }
    const index = this.items.findIndex((it) => it.kind === "orchestrate" && it.cardId === cardId);
    const item = this.items[index];
    return item?.kind === "orchestrate" ? { index, item } : null;
  }

  private with(items: ChatItem[]): ChatTranscript {
    return new ChatTranscript(items, this.factory);
  }
}
