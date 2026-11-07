import { describe, expect, it, vi } from "vitest";

import type { ServerMessage } from "../protocol/messages";
import type { RunPhase } from "./runPhase";
import { RunStreamer } from "./runStreamer";
import { ArrayTranscript } from "./transcriptView.test.util";

type Handler = (m: ServerMessage) => void;

function setup(opts: { runMessage?: (text: string, on: Handler) => Promise<void>; loop?: unknown[] } = {}) {
  const t = new ArrayTranscript();
  const phase = { current: "idle" as RunPhase };
  const run = {
    runPhaseRef: phase,
    setRunPhase: vi.fn((p: RunPhase) => {
      phase.current = p;
    }),
    viewGenRef: { current: 0 },
  };
  const loop = [...(opts.loop ?? [])];
  const client = {
    runMessage: vi.fn(opts.runMessage ?? (async () => {})),
    resolveHitlBatch: vi.fn(async () => {}),
    rpc: vi.fn(async () => loop.shift() ?? null),
  };
  const onEvent = vi.fn();
  const shell = { refreshStatus: vi.fn(async () => {}) };
  const notifier = { replyReady: vi.fn() };
  const streamer = new RunStreamer({ client: client as never, view: t.view, run, shell, notifier, onEvent });
  return { t, run, client, onEvent, shell, notifier, streamer };
}

describe("RunStreamer", () => {
  it("routes a live run's events and settles a run that ended without a terminal event", async () => {
    const msg = { type: "content_delta", text: "hi", is_thinking: false } as ServerMessage;
    const s = setup({ runMessage: async (_t, on) => on(msg) });
    await s.streamer.send("hello");
    expect(s.onEvent).toHaveBeenCalledWith(msg);
    expect(s.run.setRunPhase.mock.calls.map((c) => c[0])).toEqual(["starting", "done"]);
    expect(s.shell.refreshStatus).toHaveBeenCalled();
    expect(s.notifier.replyReady).toHaveBeenCalled();
  });

  it("drops the events of a run started before the view started over", async () => {
    const msg = { type: "content_delta", text: "late", is_thinking: false } as ServerMessage;
    const s = setup({
      runMessage: async (_t, on) => {
        s.run.viewGenRef.current++;
        on(msg);
      },
    });
    await s.streamer.send("hello");
    expect(s.onEvent).not.toHaveBeenCalled();
  });

  it("marks the reply interrupted when the run fails", async () => {
    const s = setup({
      runMessage: async () => {
        throw new Error("socket closed");
      },
    });
    await s.streamer.send("hello");
    expect(s.run.runPhaseRef.current).toBe("errored");
    expect(s.t.kinds()).toContain("error");
  });

  it("runs the next /loop iteration after a run", async () => {
    const s = setup({ loop: [{ prompt: "again" }] });
    await s.streamer.send("first");
    await vi.waitFor(() => expect(s.client.runMessage).toHaveBeenCalledTimes(2));
    expect(s.client.runMessage.mock.calls[1][0]).toBe("again");
    expect(s.client.rpc).toHaveBeenCalledWith("pop_pending_loop_iteration");
  });

  it("resumes from a HITL pause and settles from streaming", async () => {
    const s = setup();
    await s.streamer.resume([{ requirement_id: "r", action: "confirm", choice: "once" }] as never);
    expect(s.client.resolveHitlBatch).toHaveBeenCalled();
    expect(s.run.runPhaseRef.current).toBe("done");
  });

  it("retries with force, and says so when it cannot", async () => {
    const s = setup({
      runMessage: async () => {
        throw new Error("nope");
      },
    });
    await s.streamer.retry("again");
    expect(s.client.runMessage).toHaveBeenCalledWith("again", expect.any(Function), undefined, { force: true });
    expect(s.t.items.at(-1)).toMatchObject({ kind: "error", text: "Couldn't retry: nope" });
  });
});
