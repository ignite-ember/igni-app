/**
 * The window's item list as the controllers write it: one object over
 * React's setters, so a controller built once per window edits the
 * transcript without holding a copy of it.
 *
 * ``historyMap`` runs parallel to the items: ``historyMap[i]`` is where
 * the i-th ``get_chat_history`` turn landed (see ``HistoryLoader``).
 * Every write that replaces the list from somewhere else resets it.
 */

import type { Dispatch, SetStateAction } from "react";

import type { ServerMessage } from "../protocol/messages";
import type { ChatItem } from "./chatItem";
import type { ChatItemFactory } from "./chatItemFactory";
import { ChatTranscript } from "./chatTranscript";
import type { HistoryLoad } from "./historyLoader";

export class TranscriptView {
  constructor(
    private readonly setItems: Dispatch<SetStateAction<ChatItem[]>>,
    private readonly setHistoryMap: Dispatch<SetStateAction<number[]>>,
    private readonly itemsRef: { readonly current: ChatItem[] },
    readonly chatItems: ChatItemFactory,
  ) {}

  /** A list as a transcript, for a render or a read. */
  readonly transcript = (items: ChatItem[]): ChatTranscript =>
    new ChatTranscript(items, this.chatItems);

  /** The list as of the last render. */
  current(): ChatTranscript {
    return this.transcript(this.itemsRef.current);
  }

  append(item: ChatItem): void {
    this.setItems((prev) => [...prev, item]);
  }

  info(text: string): void {
    this.append(this.chatItems.info(text));
  }

  error(text: string): void {
    this.append(this.chatItems.error(text));
  }

  /** Apply one transcript step to whatever the list is by then. */
  update(step: (t: ChatTranscript) => ChatTranscript): void {
    this.setItems((prev) => step(this.transcript(prev)).items);
  }

  /** Edit the raw list (a trim, a patch of one item). */
  edit(step: (items: ChatItem[]) => ChatItem[]): void {
    this.setItems(step);
  }

  apply(m: ServerMessage): void {
    this.update((t) => t.applyServerMessage(m));
  }

  /** Replace the list outright: a new session, a menu's New Chat. */
  reset(items: ChatItem[] = []): void {
    this.setItems(items);
    this.setHistoryMap([]);
  }

  /** Keep only what was added after ``boundary`` (the highest item id
   *  when a view-clearing command was issued). */
  keepAfter(boundary: number): void {
    this.setItems((prev) => prev.filter((it) => it.id > boundary));
    this.setHistoryMap([]);
  }

  /** A session's loaded history, before whatever the list holds now. */
  prependHistory(load: HistoryLoad): void {
    this.setItems((prev) => [...load.items, ...prev]);
    this.setHistoryMap(load.historyMap);
  }

  /** A session's loaded history in place of the list, then ``after``. */
  showHistory(load: HistoryLoad, after: ChatItem[] = []): void {
    this.setItems([...load.items, ...after]);
    this.setHistoryMap(load.historyMap);
  }

  /** The history a freshly bound window shows. An empty load leaves the
   *  list alone: nothing came back to show. */
  restore(load: HistoryLoad): void {
    if (load.items.length) this.setItems(load.items);
    this.setHistoryMap(load.historyMap);
  }
}
