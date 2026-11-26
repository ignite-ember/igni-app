// @vitest-environment jsdom
/**
 * The loop page: what the running loop is doing, and pausing, resuming
 * or stopping it.
 *
 * Pinned: no loop reads as an empty page with the command to start one,
 * the iteration shows a total only when there is one worth showing,
 * Resume hands the backend's prompt to the host (and an empty one
 * nowhere), and every action re-reads the status.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LoopPanel } from "./LoopPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function panel(status: unknown, answers: Record<string, unknown> = {}) {
  const rpc = vi.fn(async (method: string) => {
    if (method === "loop_status") {
      if (status instanceof Error) throw status;
      return status;
    }
    return answers[method];
  });
  const onResume = vi.fn();
  render(<LoopPanel client={{ rpc } as never} onResume={onResume} onClose={() => {}} />);
  return { rpc, onResume };
}

const running = { active: true, prompt: "check the build", paused: false, iteration_index: 3 };

describe("the loop page", () => {
  it("says how to start a loop when none is active", async () => {
    panel({ active: false });
    expect(await screen.findByText("No active loop")).toBeTruthy();
  });

  it("stays on the empty page when the status cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    panel(new Error("offline"));
    expect(await screen.findByText("No active loop")).toBeTruthy();
  });

  it("shows the prompt, the iteration and the state", async () => {
    panel(running);
    expect(await screen.findByText("check the build")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText("Iteration").nextElementSibling?.textContent).toBe("3");
  });

  it("shows a total for an explicit cap or an announced one, not for the safety net", async () => {
    panel({ ...running, cap_explicit: true, iterations_remaining: 7 });
    await screen.findByText("check the build");
    expect(screen.getByText("Iteration").nextElementSibling?.textContent).toBe("3/10");
    cleanup();
    panel({ ...running, cap_explicit: true, iterations_remaining: 7, announced_total: 5 });
    await screen.findByText("check the build");
    expect(screen.getByText("Iteration").nextElementSibling?.textContent).toBe("3/5");
    cleanup();
    panel({ ...running, cap_explicit: false, iterations_remaining: 97 });
    await screen.findByText("check the build");
    expect(screen.getByText("Iteration").nextElementSibling?.textContent).toBe("3");
  });

  it("pauses a running loop and stops it", async () => {
    const { rpc } = panel(running);
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("loop_pause"));
    fireEvent.click(screen.getByRole("button", { name: "Stop loop" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("cancel_pending_loop"));
    expect(rpc.mock.calls.filter(([m]) => m === "loop_status").length).toBeGreaterThanOrEqual(3);
  });

  it("resumes a paused loop by handing its prompt to the host", async () => {
    const { rpc, onResume } = panel({ ...running, paused: true }, { loop_resume: "iteration 4 prompt" });
    expect(await screen.findByText("paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(onResume).toHaveBeenCalledWith("iteration 4 prompt"));
    expect(rpc).toHaveBeenCalledWith("loop_resume");
  });

  it("does nothing on Resume when the backend says there is nothing to resume", async () => {
    const { rpc, onResume } = panel({ ...running, paused: true }, { loop_resume: "" });
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("loop_resume"));
    expect(onResume).not.toHaveBeenCalled();
  });

  it("polls while open and stops when closed", async () => {
    vi.useFakeTimers();
    try {
      const rpc = vi.fn(async () => ({ active: false }));
      const { unmount } = render(<LoopPanel client={{ rpc } as never} onResume={() => {}} onClose={() => {}} />);
      expect(rpc).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_500);
      expect(rpc).toHaveBeenCalledTimes(2);
      unmount();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(rpc).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
