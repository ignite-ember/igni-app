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

function mount(phase: RunPhase = "idle") {
  const client = { resolveHitlBatch: vi.fn(async () => {}) };
  const run = { runPhaseRef: { current: phase }, cancel: vi.fn() };
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

  it("cancels a run on Escape when nothing is waiting for approval", () => {
    const { client, run } = mount("streaming");
    pressEscape();
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(client.resolveHitlBatch).not.toHaveBeenCalled();
  });

  it("leaves Escape to the OS when idle", () => {
    const { client, run } = mount("idle");
    const e = pressEscape();
    expect(run.cancel).not.toHaveBeenCalled();
    expect(client.resolveHitlBatch).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
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
