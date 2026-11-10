import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssistantItem, UserItem } from "./chatItem";
import { TranscriptEdits } from "./transcriptEdits";
import { ArrayTranscript } from "./transcriptView.test.util";

type Rpc = (method: string, args?: Record<string, unknown>) => Promise<unknown>;

function setup(opts: { rpc?: Rpc; session?: string } = {}) {
  const t = new ArrayTranscript();
  const client = { rpc: vi.fn<Rpc>(opts.rpc ?? (async () => ({ removed: 1 }))) };
  const streamer = {
    send: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    generation: vi.fn(() => 3),
  };
  const windowModel = { get: vi.fn(() => opts.session ?? "s1") };
  const shell = { refreshStatus: vi.fn(async () => {}), seedComposer: vi.fn() };
  const edits = new TranscriptEdits({
    client: client as never,
    view: t.view,
    streamer,
    windowModel: windowModel as never,
    shell,
  });
  return { t, client, streamer, shell, edits };
}

/** before → the user message → its reply, the reply cut off. */
function conversation(t: ArrayTranscript, user: Partial<UserItem>) {
  const before = t.chatItems.info("earlier");
  const prompt: UserItem = { ...t.chatItems.user("fix the bug"), ...user };
  const reply: AssistantItem = { ...t.chatItems.assistant("partial"), interrupted: "cancelled" };
  t.items = [before, prompt, reply];
  return { before, prompt, reply };
}

afterEach(() => vi.restoreAllMocks());

describe("TranscriptEdits: edit and delete", () => {
  it("truncates a persisted run on the backend, then trims from the message on", async () => {
    const s = setup();
    const { before, prompt } = conversation(s.t, { runId: "r1", persisted: true });
    await s.edits.deleteUser(prompt);
    expect(s.client.rpc).toHaveBeenCalledWith("truncate_history", { session_id: "s1", run_id: "r1" });
    expect(s.t.items).toEqual([before]);
    expect(s.shell.refreshStatus).toHaveBeenCalled();
  });

  it("trims locally, without the RPC, a run that never persisted", async () => {
    const s = setup();
    const { before, prompt } = conversation(s.t, { runId: "r1" });
    await s.edits.deleteUser(prompt);
    expect(s.client.rpc).not.toHaveBeenCalled();
    expect(s.t.items).toEqual([before]);
  });

  it("keeps everything and says why when the backend refuses the truncation", async () => {
    const s = setup({ rpc: async () => ({ error: "run not found" }) });
    const { prompt } = conversation(s.t, { runId: "r1", persisted: true });
    await s.edits.editUser(prompt, "fix it properly");
    expect(s.t.kinds()).toEqual(["info", "user", "assistant", "error"]);
    expect(s.t.items.at(-1)).toMatchObject({ text: "Couldn't edit/delete: run not found" });
    expect(s.streamer.send).not.toHaveBeenCalled();
  });

  it("says why when the truncation call itself fails", async () => {
    const s = setup({ rpc: async () => Promise.reject(new Error("socket closed")) });
    const { prompt } = conversation(s.t, { runId: "r1", persisted: true });
    await s.edits.deleteUser(prompt);
    expect(s.t.items.at(-1)).toMatchObject({ kind: "error", text: "Couldn't edit/delete: socket closed" });
  });

  it("does nothing for a message with no run, or a window with no session", async () => {
    const noRun = setup();
    const a = conversation(noRun.t, {});
    await noRun.edits.deleteUser(a.prompt);
    expect(noRun.t.items).toHaveLength(3);

    const noSession = setup({ session: "" });
    const b = conversation(noSession.t, { runId: "r1", persisted: true });
    await noSession.edits.deleteUser(b.prompt);
    expect(noSession.t.items).toHaveLength(3);
    expect(noSession.client.rpc).not.toHaveBeenCalled();
  });

  it("resends an edit as a new bubble and a new run", async () => {
    const s = setup();
    const { before, prompt } = conversation(s.t, { runId: "r1", persisted: true });
    await s.edits.editUser(prompt, "fix it properly");
    expect(s.t.items[0]).toBe(before);
    expect(s.t.items.slice(1)).toMatchObject([{ kind: "user", text: "fix it properly" }]);
    expect(s.streamer.send).toHaveBeenCalledWith("fix it properly");
  });
});

describe("TranscriptEdits: the interrupted banner", () => {
  it("Retry trims, re-adds the bubble and re-fires as of the generation before the trim", async () => {
    const s = setup();
    const { reply } = conversation(s.t, { runId: "r1" });
    await s.edits.retryInterrupted(reply.id);
    expect(s.t.items.slice(1)).toMatchObject([{ kind: "user", text: "fix the bug" }]);
    expect(s.streamer.retry).toHaveBeenCalledWith("fix the bug", 3);
  });

  it("Retry does nothing for a prompt with no run", async () => {
    const s = setup();
    const { reply } = conversation(s.t, {});
    await s.edits.retryInterrupted(reply.id);
    expect(s.streamer.retry).not.toHaveBeenCalled();
    expect(s.t.items).toHaveLength(3);
  });

  it("Discard trims and drops the backend's interrupted record whose text matches", async () => {
    const s = setup({
      rpc: async (method) =>
        method === "get_interrupted_runs"
          ? [
              { message_id: "m0", content: "something else" },
              { message_id: "m1", content: "fix the bug" },
            ]
          : undefined,
    });
    const { before, reply } = conversation(s.t, { runId: "r1" });
    await s.edits.discardInterrupted(reply.id);
    expect(s.t.items).toEqual([before]);
    expect(s.client.rpc).toHaveBeenCalledWith("discard_interrupted_run", { session_id: "s1", message_id: "m1" });
  });

  it("Discard still trims when the backend cannot be asked", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ rpc: async () => Promise.reject(new Error("offline")) });
    const { before, reply } = conversation(s.t, { runId: "r1" });
    await s.edits.discardInterrupted(reply.id);
    expect(s.t.items).toEqual([before]);
    expect(warn).toHaveBeenCalled();
  });

  it("Edit prompt trims and puts the original prompt back in the composer", async () => {
    const s = setup();
    const { before, reply } = conversation(s.t, { runId: "r1" });
    await s.edits.editPrompt(reply.id);
    expect(s.t.items).toEqual([before]);
    expect(s.shell.seedComposer).toHaveBeenCalledWith("fix the bug");
  });
});
