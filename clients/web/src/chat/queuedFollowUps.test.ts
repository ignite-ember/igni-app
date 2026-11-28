/**
 * A message typed while a turn works, end to end through the window's
 * own controllers: the composer's choice between ``queue_message`` and a
 * run, the backend's echo, and where the bubble ends up (session
 * 6fa3e09e, harness finding F10).
 */

import { describe, expect, it, vi } from "vitest";

import type { ServerMessage } from "../protocol/messages";
import type { ChatItem } from "./chatItem";
import { HitlRequests, type OpenApprovals } from "./hitlRequests";
import { MessageSubmitter } from "./messageSubmitter";
import { MirrorEventRouter } from "./mirrorEventRouter";
import type { RunPhase } from "./runPhase";
import { RunStreamer } from "./runStreamer";
import { SentMessages } from "./sentMessages";
import { StreamEventRouter } from "./streamEventRouter";
import { ArrayTranscript } from "./transcriptView.test.util";

type Handler = (m: ServerMessage) => void;

interface OpenStream {
  text: string;
  on: Handler;
  end: () => void;
}

function window() {
  const t = new ArrayTranscript();
  const ref = { current: "idle" as RunPhase };
  const run = {
    runPhaseRef: ref,
    setRunPhase: (p: RunPhase) => {
      ref.current = p;
    },
    viewGenRef: { current: 0 },
    autoAcceptForRunRef: { current: false },
  };
  let open: OpenApprovals = null;
  const hitl = new HitlRequests((next) => {
    open = typeof next === "function" ? next(open) : next;
  });
  const streams: OpenStream[] = [];
  const queued: string[] = [];
  const client = {
    clientId: "me",
    queueMessage: (text: string) => queued.push(text),
    runMessage: (text: string, on: Handler, _f?: unknown, o: { signal?: AbortSignal } = {}) =>
      new Promise<void>((resolve) => {
        streams.push({ text, on, end: resolve });
        o.signal?.addEventListener("abort", () => resolve());
      }),
    resolveHitlBatch: () => Promise.resolve(),
    rpc: vi.fn(async () => null),
    calls: { runShell: vi.fn() },
  };
  const shell = {
    setStatus: vi.fn(),
    refreshStatus: vi.fn(async () => {}),
    refreshSessions: vi.fn(async () => {}),
  };
  const streamEvents = new StreamEventRouter({
    client: client as never,
    view: t.view,
    hitl,
    run,
    shell,
    revertAutoAccept: () => {},
  });
  const streamer = new RunStreamer({
    client: client as never,
    view: t.view,
    run,
    shell,
    notifier: { replyReady: vi.fn() },
    onEvent: (m) => streamEvents.route(m),
  });
  const sent = new SentMessages(t.view);
  const mirror = new MirrorEventRouter({
    client: client as never,
    view: t.view,
    hitl,
    run,
    shell,
    pushRouter: { route: vi.fn() },
    sent,
  });
  const submitter = new MessageSubmitter({
    client: client as never,
    view: t.view,
    run,
    commands: { run: vi.fn(async () => {}) },
    streamer,
    sent,
  });
  /** Type and send, without waiting for the run to end. */
  const type = (text: string) => {
    void submitter.submit(text);
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { t, run, streams, queued, mirror, type, flush };
}

const runStarted = (run_id: string): ServerMessage =>
  ({ type: "run_started", run_id, parent_run_id: null, agent_name: "igni", model: "m" }) as ServerMessage;
const delta = (text: string): ServerMessage => ({ type: "content_delta", text, is_thinking: false }) as ServerMessage;
const streamingDone = (run_id: string): ServerMessage => ({ type: "streaming_done", run_id }) as ServerMessage;
const toolStarted = { type: "tool_started", tool_name: "web_search", args_summary: "", run_id: "r1" } as ServerMessage;
const toolDone = (full_result: string): ServerMessage =>
  ({ type: "tool_completed", summary: "", full_result, run_id: "r1", has_markup: false, diff_rows: null, is_error: false }) as ServerMessage;
const runCompleted = (run_id: string): ServerMessage =>
  ({ type: "run_completed", run_id, parent_run_id: null, input_tokens: 0, output_tokens: 0, duration: 1 }) as ServerMessage;
const carrying = (result: string, ...texts: string[]) =>
  `${result}\n\n[USER MESSAGE WHILE YOU WERE WORKING]\n${texts.map((x) => `- ${x}`).join("\n")}\n[END USER MESSAGE]`;
const echo = (text: string, queued: boolean): ServerMessage =>
  ({ type: "user_message_received", text, client_id: "me", queued }) as ServerMessage;

const shown = (items: ChatItem[]) =>
  items
    .filter((it) => it.kind === "user" || it.kind === "tool" || it.kind === "assistant")
    .map((it) => (it.kind === "tool" ? "[tool]" : `${it.kind === "user" ? ">" : ""}${"text" in it ? it.text : ""}${"queued" in it && it.queued ? " (queued)" : ""}`));

describe("a message typed while a turn works", () => {
  it("between the turn's steps is queued, shown queued, and sent where the turn took it in — two in order", async () => {
    const w = window();
    w.type("Who gave the dream speech?");
    const [own] = w.streams;
    own.on(runStarted("r1"));
    own.on(delta("Let me check."));
    // agno says content is done before the tool call: the phase reads
    // finalizing, yet the turn is working.
    own.on(streamingDone("r1"));
    expect(w.run.runPhaseRef.current).toBe("finalizing");
    own.on(toolStarted);
    w.type("No, search the internet");
    w.type("and cite it");
    // Queued, not sent as runs of their own.
    expect(w.queued).toEqual(["No, search the internet", "and cite it"]);
    expect(w.streams).toHaveLength(1);
    expect(shown(w.t.items)).toEqual([
      ">Who gave the dream speech?",
      "Let me check.",
      "[tool]",
      ">No, search the internet (queued)",
      ">and cite it (queued)",
    ]);
    // The tool call carries both to the model.
    own.on(toolDone(carrying("results", "No, search the internet", "and cite it")));
    own.on(delta("Searching the web."));
    own.on(runCompleted("r1"));
    own.end();
    await w.flush();
    expect(shown(w.t.items)).toEqual([
      ">Who gave the dream speech?",
      "Let me check.",
      "[tool]",
      ">No, search the internet",
      ">and cite it",
      "Searching the web.",
    ]);
    expect(w.run.runPhaseRef.current).toBe("done");
  });

  it("in a turn resumed after an approval is queued, also between its steps", async () => {
    const w = window();
    w.mirror.route({ type: "run_paused", run_id: "r1", requirements: [{ requirement_id: "a" }] } as ServerMessage);
    // Another view approved it: the turn resumes.
    w.mirror.route({ type: "requirement_resolved", requirement_id: "a" } as ServerMessage);
    w.type("one");
    w.mirror.route(streamingDone("r1"));
    w.type("two");
    expect(w.queued).toEqual(["one", "two"]);
    expect(w.streams).toHaveLength(0);
  });

  it("while the turn waits on an approval goes as a run: it ends that turn", () => {
    const w = window();
    w.mirror.route({ type: "run_paused", run_id: "r1", requirements: [{ requirement_id: "a" }] } as ServerMessage);
    w.type("never mind, do this");
    expect(w.queued).toEqual([]);
    expect(w.streams.map((s) => s.text)).toEqual(["never mind, do this"]);
  });

  it("that went as a run but the backend queued is shown queued, and sent when its own turn starts", async () => {
    const w = window();
    // The window thinks nothing runs; the backend has a turn working.
    w.type("one more thing");
    w.mirror.route(echo("one more thing", true));
    await w.flush();
    expect(shown(w.t.items)).toEqual([">one more thing (queued)"]);
    // Its stream ended without a reply; the turn it waits behind is busy.
    expect(w.run.runPhaseRef.current).toBe("streaming");
    // A message typed now is queued behind it, in order.
    w.type("and another");
    expect(w.queued).toEqual(["and another"]);
    // The working turn ends; the backend runs the queued messages next.
    w.mirror.route(runCompleted("r0"));
    w.mirror.route({ type: "stream_end" } as ServerMessage);
    w.mirror.route(runStarted("r2"));
    expect(shown(w.t.items)).toEqual([">one more thing", ">and another (queued)"]);
    w.mirror.route(delta("Sure."));
    w.mirror.route(runCompleted("r2"));
    w.mirror.route(runStarted("r3"));
    expect(shown(w.t.items)).toEqual([">one more thing", "Sure.", ">and another"]);
  });

  it("that the backend ran stays an ordinary message", async () => {
    const w = window();
    w.type("hello");
    w.mirror.route(echo("hello", false));
    w.streams[0].on(runStarted("r1"));
    w.streams[0].on(runCompleted("r1"));
    w.streams[0].end();
    await w.flush();
    expect(shown(w.t.items)).toEqual([">hello"]);
    expect(w.run.runPhaseRef.current).toBe("done");
  });
});
