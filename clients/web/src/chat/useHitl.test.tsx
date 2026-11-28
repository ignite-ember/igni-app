// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import type { HITLRequest } from "../protocol/messages";
import type { RunPhase } from "./runPhase";
import { useHitl } from "./useHitl";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.fullscreen;
});

const REQUESTS = [
  { requirement_id: "q1", tool_name: "write_file" },
  { requirement_id: "q2", tool_name: "run_shell" },
] as unknown as HITLRequest[];

function mount(phase: RunPhase = "idle", sessionActive = false) {
  const client = { resolveHitlBatch: vi.fn(async () => {}) };
  const run = { runPhaseRef: { current: phase }, cancel: vi.fn(), sessionActiveRef: { current: sessionActive } };
  const hook = renderHook(() => useHitl(client, run));
  return { hook, client, run };
}

function pressEscape(): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

describe("useHitl", () => {
  it("rejects every open approval in one batch on Escape, and cancels the run", () => {
    const { hook, client, run } = mount("streaming");
    act(() => hook.result.current.requests.show(REQUESTS));
    pressEscape();
    expect(client.resolveHitlBatch).toHaveBeenCalledTimes(1);
    expect((client.resolveHitlBatch.mock.calls[0] as unknown[])[0]).toEqual([
      { requirement_id: "q1", action: "reject", choice: "" },
      { requirement_id: "q2", action: "reject", choice: "" },
    ]);
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.pending).toBeNull();
  });

  it("Stop does what Escape does while approvals wait: one batch of rejections, then cancel", () => {
    const { hook, client, run } = mount("awaiting_approval");
    act(() => hook.result.current.requests.show(REQUESTS));
    act(() => hook.result.current.stop());
    expect(client.resolveHitlBatch).toHaveBeenCalledTimes(1);
    expect((client.resolveHitlBatch.mock.calls[0] as unknown[])[0]).toEqual([
      { requirement_id: "q1", action: "reject", choice: "" },
      { requirement_id: "q2", action: "reject", choice: "" },
    ]);
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(hook.result.current.pending).toBeNull();
  });

  it("Stop with nothing waiting only cancels", () => {
    const { hook, client, run } = mount("streaming");
    act(() => hook.result.current.stop());
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(client.resolveHitlBatch).not.toHaveBeenCalled();
  });

  it("Escape answers a paused run's approvals even though nothing is streaming", () => {
    const { hook, client, run } = mount("awaiting_approval");
    act(() => hook.result.current.requests.show(REQUESTS));
    const e = pressEscape();
    expect(e.defaultPrevented).toBe(true);
    expect(client.resolveHitlBatch).toHaveBeenCalledTimes(1);
    expect(run.cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels a run on Escape when nothing is waiting for approval", () => {
    const { client, run } = mount("streaming");
    pressEscape();
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(client.resolveHitlBatch).not.toHaveBeenCalled();
  });

  // Session 6fa3e09e: ten presses of Escape did nothing while a run resumed
  // after its approval went on — this view's phase had settled to `done`.
  it.each(["starting", "streaming", "finalizing", "awaiting_approval"] as const)(
    "Escape sends the cancel in phase %s",
    (phase) => {
      const { run } = mount(phase);
      const e = pressEscape();
      expect(run.cancel).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);
    },
  );

  it.each(["idle", "done", "cancelled", "errored", "finalizing"] as const)(
    "Escape sends the cancel in phase %s when the backend says a run goes on",
    (phase) => {
      const { client, run } = mount(phase, true);
      const e = pressEscape();
      expect(run.cancel).toHaveBeenCalledTimes(1);
      expect(client.resolveHitlBatch).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
    },
  );

  it("Escape follows the backend's word as it changes, without a remount", () => {
    const { run } = mount("done");
    pressEscape();
    expect(run.cancel).not.toHaveBeenCalled();
    run.sessionActiveRef.current = true;
    pressEscape();
    expect(run.cancel).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to the OS when idle", () => {
    const { client, run } = mount("idle");
    const e = pressEscape();
    expect(run.cancel).not.toHaveBeenCalled();
    expect(client.resolveHitlBatch).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("a pause re-sent after an attach replaces the open approvals rather than adding a dialog", () => {
    const { hook } = mount("idle");
    act(() => hook.result.current.requests.show(REQUESTS));
    act(() => hook.result.current.requests.show(REQUESTS));
    expect(hook.result.current.pending?.map((r) => r.requirement_id)).toEqual(["q1", "q2"]);
  });

  it("drops one approval another view answered, and closes when none is left", () => {
    const { hook } = mount();
    act(() => hook.result.current.requests.show(REQUESTS));
    act(() => hook.result.current.requests.resolved("q1"));
    expect(hook.result.current.pending?.map((r) => r.requirement_id)).toEqual(["q2"]);
    act(() => hook.result.current.requests.resolved("q2"));
    expect(hook.result.current.pending).toBeNull();
  });

  it("adds the safety check's reason to the approval it belongs to", () => {
    const { hook } = mount();
    act(() => hook.result.current.requests.show(REQUESTS));
    act(() => hook.result.current.requests.addDetails({ requirement_id: "q2", details: "writes outside the repo" }));
    const q2 = hook.result.current.pending?.find((r) => r.requirement_id === "q2");
    expect(q2?.details).toBe("writes outside the repo");
  });
});
