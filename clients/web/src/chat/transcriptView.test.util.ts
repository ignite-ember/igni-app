/**
 * A {@link TranscriptView} over a plain array, for controller tests:
 * every write lands at once and ``items`` reads it back.
 */

import type { SetStateAction } from "react";

import type { ChatItem } from "./chatItem";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { TranscriptView } from "./transcriptView";

export class ArrayTranscript {
  items: ChatItem[] = [];
  historyMap: number[] = [];
  readonly view: TranscriptView;

  constructor(readonly chatItems = new ChatItemFactory(new ChatItemIds())) {
    const ref = { get current() { return self.items; } };
    const self = this;
    this.view = new TranscriptView(
      (next: SetStateAction<ChatItem[]>) => {
        self.items = typeof next === "function" ? next(self.items) : next;
      },
      (next: SetStateAction<number[]>) => {
        self.historyMap = typeof next === "function" ? next(self.historyMap) : next;
      },
      ref,
      chatItems,
    );
  }

  kinds(): string[] {
    return this.items.map((it) => it.kind);
  }
}
