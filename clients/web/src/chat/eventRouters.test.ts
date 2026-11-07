import { describe, expect, it, vi } from "vitest";

import type { ServerMessage } from "../protocol/messages";
import { HitlRequests, type OpenApprovals } from "./hitlRequests";
import { MirrorEventRouter } from "./mirrorEventRouter";
import type { RunPhase } from "./runPhase";
import { StreamEventRouter } from "./streamEventRouter";
import { ArrayTranscript } from "./transcriptView.test.util";

function phase(initial: RunPhase = "idle") {
  const ref = { current: initial };
  return {
    runPhaseRef: ref,
    setRunPhase: vi.fn((p: RunPhase) => {
      ref.current = p;
    }),
    autoAcceptForRunRef: { current: false },
  };
}

function approvals() {
  let open: OpenApprovals = null;
  const requests = new HitlRequests((next) => {
    open = typeof next === "function" ? next(open) : next;
  });
  return { requests, open: () => open };
}

const req = (id: string) => ({ requirement_id: id }) as never;

describe("StreamEventRouter", () => {
  function setup(ctx: unknown = 900) {
    const t = new ArrayTranscript();
    const run = phase("streaming");
    const hitl = approvals();
    const shell = {
      setStatus: vi.fn(),
      refreshStatus: vi.fn(async () => {}),
      refreshSessions: vi.fn(async () => {}),
    };
    const revertAutoAccept = vi.fn();
    const client = { rpc: vi.fn(async () => ctx) };
    const router = new StreamEventRouter({ client: client as never, view: t.view, hitl: hitl.requests, run, shell, revertAutoAccept });
    return { t, run, hitl, shell, revertAutoAccept, client, router };
  }

  it("finalizes when content ends, and turns this run's auto-accept back off", () => {
    const s = setup();
    s.run.autoAcceptForRunRef.current = true;
    s.router.route({ type: "streaming_done", run_id: "r" } as ServerMessage);
    expect(s.run.runPhaseRef.current).toBe("finalizing");
    expect(s.revertAutoAccept).toHaveBeenCalledTimes(1);
    expect(s.run.autoAcceptForRunRef.current).toBe(false);
  });

  it("opens and details the approvals a run pauses on", () => {
    const s = setup();
    s.router.route({ type: "run_paused", run_id: "r", requirements: [req("a")] } as ServerMessage);
    s.router.route({ type: "requirement_details", requirement_id: "a", details: "why" } as ServerMessage);
    expect(s.hitl.open()).toEqual([{ requirement_id: "a", details: "why", details_pending: false }]);
  });

  it("shows a command's result, as an error when it is one", () => {
    const s = setup();
    s.router.route({ type: "command_result", kind: "error", content: "bad", display_content: "" } as ServerMessage);
    s.router.route({ type: "command_result", kind: "markdown", content: "", display_content: "" } as ServerMessage);
    expect(s.t.kinds()).toEqual(["error"]);
  });

  it("finishes a top-level run: done, persisted, and the real context count", async () => {
    const s = setup();
    s.router.route({ type: "status_update" } as ServerMessage);
    expect(s.shell.setStatus).toHaveBeenCalled();
    s.router.route({ type: "run_started", run_id: "r1", parent_run_id: null } as ServerMessage);
    s.router.route({ type: "run_completed", run_id: "r1", parent_run_id: null } as ServerMessage);
    expect(s.run.runPhaseRef.current).toBe("done");
    expect(s.shell.refreshSessions).toHaveBeenCalled();
    await vi.waitFor(() => expect(s.shell.refreshStatus).toHaveBeenCalled());
  });

  it("leaves the phase alone for a sub-agent's run", () => {
    const s = setup();
    s.router.route({ type: "run_completed", run_id: "r2", parent_run_id: "r1" } as ServerMessage);
    expect(s.run.runPhaseRef.current).toBe("streaming");
  });
});

describe("MirrorEventRouter", () => {
  function setup() {
    const t = new ArrayTranscript();
    const run = phase();
    const hitl = approvals();
    const shell = { setStatus: vi.fn() };
    const pushRouter = { route: vi.fn() };
    const router = new MirrorEventRouter({
      client: { clientId: "me" },
      view: t.view,
      hitl: hitl.requests,
      run,
      shell,
      pushRouter,
    });
    return { t, run, hitl, shell, pushRouter, router };
  }

  it("paints other views' messages, not this view's echo", () => {
    const s = setup();
    s.router.route({ type: "user_message_received", text: "mine", client_id: "me", queued: false } as ServerMessage);
    s.router.route({ type: "user_message_received", text: "theirs", client_id: "you", queued: true } as ServerMessage);
    s.router.route({
      type: "user_message_received",
      text: "ext",
      client_id: "me",
      queued: false,
      extension_id: "x",
    } as ServerMessage);
    expect(s.t.kinds()).toEqual(["user", "info", "user"]);
    expect(s.t.items[2]).toMatchObject({ fromExtension: "x" });
  });

  it("drops an approval another view answered", () => {
    const s = setup();
    s.router.route({ type: "run_paused", run_id: "r", requirements: [req("a"), req("b")] } as ServerMessage);
    s.router.route({ type: "requirement_resolved", requirement_id: "a" } as ServerMessage);
    expect(s.hitl.open()).toEqual([req("b")]);
    s.router.route({ type: "requirement_resolved", requirement_id: "b" } as ServerMessage);
    expect(s.hitl.open()).toBeNull();
  });

  it("ignores welcome and typing, and routes pushes", () => {
    const s = setup();
    s.router.route({ type: "welcome", client_id: "me" } as ServerMessage);
    s.router.route({ type: "typing", text: "x", client_id: "you" } as ServerMessage);
    s.router.route({ type: "push_notification", channel: "session_named", payload: {} } as ServerMessage);
    expect(s.t.items).toEqual([]);
    expect(s.pushRouter.route).toHaveBeenCalled();
  });

  it("follows another view's run as busy, and renders it", () => {
    const s = setup();
    s.router.route({ type: "run_started", run_id: "r", parent_run_id: null, agent_name: "a", model: "m" } as ServerMessage);
    expect(s.run.runPhaseRef.current).not.toBe("idle");
    s.router.route({ type: "content_delta", text: "hi", is_thinking: false } as ServerMessage);
    expect(s.t.kinds()).toContain("assistant");
  });
});
