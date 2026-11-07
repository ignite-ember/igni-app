/**
 * A session's persisted history, and the messages a crash interrupted,
 * as renderable items — on first attach, on a fork, on a session pick.
 */

import type { IgniClient } from "../protocol/client";
import { parseHistoryTurn } from "../protocol/historyTurns";
import { WirePayload } from "../protocol/wirePayload";
import { countOf } from "../lib/plural";
import type { ChatItem } from "./chatItem";
import type { ChatItemFactory } from "./chatItemFactory";
import type { HistoryTurnMapper } from "./historyTurnMapper";

export interface HistoryLoad {
  items: ChatItem[];
  /** ``historyMap[i]`` is where the i-th ``get_chat_history`` turn
   *  landed in ``items``, or -1 when the mapper dropped it. The chat
   *  search turns the backend's match indices into scroll targets with
   *  it. */
  historyMap: number[];
}

export class HistoryLoader {
  constructor(
    private readonly client: Pick<IgniClient, "rpc">,
    private readonly mapper: HistoryTurnMapper,
    private readonly factory: ChatItemFactory,
  ) {}

  /** Never throws: no history is a fresh session, and crash recovery
   *  is best-effort. */
  async load(sessionId: string): Promise<HistoryLoad> {
    const load: HistoryLoad = { items: [], historyMap: [] };
    try {
      this.addHistory(load, await this.client.rpc<unknown>("get_chat_history", { session_id: sessionId }));
    } catch {
      /* no history: a fresh session */
    }
    try {
      this.addPending(load, await this.client.rpc<unknown>("get_pending_messages", { session_id: sessionId }));
    } catch {
      /* crash recovery is best-effort */
    }
    return load;
  }

  /** Plan cards come inline (a ``plan`` turn where the agent submitted
   *  one), so the conversation's order is the history's. */
  private addHistory(load: HistoryLoad, turns: unknown): void {
    // The reply text per run, so a stats line estimates its visible
    // output from what was shown — as the live path does.
    const assistantTextByRun = new Map<string, string>();
    for (const raw of Array.isArray(turns) ? turns : []) {
      const turn = parseHistoryTurn(raw);
      const runId = turn.run_id;
      if (turn.role === "stats") {
        load.historyMap.push(load.items.length);
        load.items.push(this.mapper.stats(turn, assistantTextByRun.get(runId) ?? ""));
        continue;
      }
      const item = this.mapper.mapPersisted(turn);
      if (!item) {
        load.historyMap.push(-1);
        continue;
      }
      if (item.kind === "assistant" && runId) {
        const prev = assistantTextByRun.get(runId) ?? "";
        assistantTextByRun.set(runId, prev ? `${prev} ${item.text}` : item.text);
      }
      load.historyMap.push(load.items.length);
      load.items.push(item);
    }
  }

  /** Messages stored before a run that never finished. They hold the
   *  post-processed prompt, so they go through the mapper to show only
   *  what was typed. */
  private addPending(load: HistoryLoad, pending: unknown): void {
    if (!Array.isArray(pending) || pending.length === 0) return;
    for (const row of pending) {
      const item = this.mapper.map(
        parseHistoryTurn({ role: "user", content: new WirePayload(row).value("content") }),
      );
      if (item) load.items.push(item);
    }
    load.items.push(
      this.factory.info(
        `${countOf(pending.length, "message")} above ${
          pending.length === 1 ? "was" : "were"
        } interrupted before completion — the agent knows and can pick up where it left off.`,
      ),
    );
  }
}
