import { describe, expect, it, vi } from "vitest";

import type { AssistantItem } from "./chatItem";
import { MessageSubmitter } from "./messageSubmitter";
import { QUEUED_NOTE } from "./mirrorEventRouter";
import type { RunPhase } from "./runPhase";
import { ArrayTranscript } from "./transcriptView.test.util";

function setup(opts: { phase?: RunPhase; runShell?: () => Promise<{ output: string; exitCode: number }> } = {}) {
  const t = new ArrayTranscript();
  const client = {
    queueMessage: vi.fn(),
    calls: { runShell: vi.fn(opts.runShell ?? (async () => ({ output: "ok\n", exitCode: 0 }))) },
  };
  const commands = { run: vi.fn(async () => {}) };
  const streamer = { send: vi.fn(async () => {}) };
  const run = { runPhaseRef: { current: opts.phase ?? ("idle" as RunPhase) } };
  const submitter = new MessageSubmitter({ client: client as never, view: t.view, run, commands, streamer });
  return { t, client, commands, streamer, submitter };
}

describe("MessageSubmitter", () => {
  it("hands a slash command to the command router, with no bubble of its own", async () => {
    const s = setup();
    await s.submitter.submit("/help");
    expect(s.commands.run).toHaveBeenCalledWith("/help");
    expect(s.t.items).toEqual([]);
    expect(s.streamer.send).not.toHaveBeenCalled();
  });

  it("runs a $ line as a shell card and fills in its output and exit code", async () => {
    const s = setup({ runShell: async () => ({ output: "nope\n", exitCode: 2 }) });
    await s.submitter.submit("$  ls -la ");
    expect(s.client.calls.runShell).toHaveBeenCalledWith("ls -la");
    expect(s.t.items).toMatchObject([{ kind: "shell", command: "ls -la", output: "nope\n", exitCode: 2 }]);
  });

  it("leaves the shell card and adds the error when the command cannot run", async () => {
    const s = setup({ runShell: async () => Promise.reject(new Error("no shell")) });
    await s.submitter.submit("$ ls");
    expect(s.t.kinds()).toEqual(["shell", "error"]);
    expect(s.t.items[0]).toMatchObject({ exitCode: null });
  });

  it("paints the bubble and sends the message as a run", async () => {
    const s = setup();
    await s.submitter.submit("hello");
    expect(s.t.items).toMatchObject([{ kind: "user", text: "hello" }]);
    expect(s.streamer.send).toHaveBeenCalledWith("hello");
  });

  it("queues a message behind a run in flight, and says so", async () => {
    const s = setup({ phase: "streaming" });
    await s.submitter.submit("and then this");
    expect(s.client.queueMessage).toHaveBeenCalledWith("and then this");
    expect(s.t.items).toMatchObject([
      { kind: "user", text: "and then this" },
      { kind: "info", text: QUEUED_NOTE },
    ]);
    expect(s.streamer.send).not.toHaveBeenCalled();
  });

  it("resumes from an interrupted partial: the run gets the context, the bubble what was typed", async () => {
    const s = setup();
    const partial: AssistantItem = { ...s.t.chatItems.assistant("half an answer"), interrupted: "cancelled" };
    s.t.items = [s.t.chatItems.user("question"), partial];
    await s.submitter.submit("continue");
    const sent = (s.streamer.send.mock.calls[0] as unknown[])[0] as string;
    expect(sent).not.toBe("continue");
    expect(sent).toContain("half an answer");
    expect(sent).toContain("continue");
    expect(s.t.items.at(-1)).toMatchObject({ kind: "user", text: "continue" });
    // The partial is consumed once, not prepended to every later message.
    expect((s.t.items[1] as AssistantItem).interrupted).toBeUndefined();
  });
});
