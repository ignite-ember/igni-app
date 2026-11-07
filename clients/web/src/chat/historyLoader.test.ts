import { describe, expect, it } from "vitest";

import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { HistoryLoader } from "./historyLoader";
import { HistoryTurnMapper } from "./historyTurnMapper";

function loader(answers: Record<string, unknown | Error>) {
  const factory = new ChatItemFactory(new ChatItemIds());
  const client = {
    rpc: async <T,>(method: string): Promise<T> => {
      const answer = answers[method];
      if (answer instanceof Error) throw answer;
      return answer as T;
    },
  };
  return new HistoryLoader(client as never, new HistoryTurnMapper(factory), factory);
}

describe("HistoryLoader", () => {
  it("maps the history, stamping user messages as their persisted runs", async () => {
    const load = await loader({
      get_chat_history: [
        { role: "user", content: "hi", run_id: "r1" },
        { role: "assistant", content: "hello", run_id: "r1" },
        { role: "assistant", content: "", run_id: "r1" },
        { role: "stats", run_id: "r1", input_tokens: 1, output_tokens: 2, duration: 1 },
      ],
      get_pending_messages: [],
    }).load("s1");
    expect(load.items.map((i) => i.kind)).toEqual(["user", "assistant", "stats"]);
    expect(load.items[0]).toMatchObject({ kind: "user", runId: "r1", persisted: true });
    expect(load.historyMap).toEqual([0, 1, -1, 2]);
  });

  it("does not stamp a user message without a run", async () => {
    const load = await loader({ get_chat_history: [{ role: "user", content: "hi" }] }).load("s1");
    expect(load.items[0]).not.toHaveProperty("persisted");
  });

  it("adds the interrupted messages and says so", async () => {
    const load = await loader({
      get_chat_history: new Error("no session"),
      get_pending_messages: [{ content: "one" }, { content: "two" }],
    }).load("s1");
    expect(load.items.map((i) => i.kind)).toEqual(["user", "user", "info"]);
    expect(load.items[2]).toMatchObject({ text: expect.stringMatching(/^2 messages above were interrupted/) });
    expect(load.historyMap).toEqual([]);
  });

  it("is empty when the backend has nothing, or fails", async () => {
    const load = await loader({
      get_chat_history: null,
      get_pending_messages: new Error("old backend"),
    }).load("s1");
    expect(load).toEqual({ items: [], historyMap: [] });
  });
});
