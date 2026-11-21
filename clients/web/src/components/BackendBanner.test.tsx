// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BackendSnapshot } from "../cloud/backendState";
import { shellSnapshot } from "../cloud/testing";
import { BackendBanner, type BackendActions } from "./BackendBanner";
import { WAKING_DELAY_MS, WakingOverlay } from "./WakingOverlay";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const snap = (o: Record<string, unknown> = {}) => BackendSnapshot.parse(shellSnapshot(o))!;

function actions(): BackendActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    signIn: vi.fn(async () => void calls.push("signIn")),
    retry: vi.fn(() => void calls.push("retry")),
    useThisComputer: vi.fn(async () => void calls.push("local")),
    dismiss: vi.fn(() => void calls.push("dismiss")),
  };
}

describe("BackendBanner", () => {
  it("draws nothing on a healthy side", () => {
    for (const o of [{}, { side: "cloud", state: "cloud_ready" }, { side: "cloud", state: "waking" }, { side: "cloud", state: "needs_desktop_sign_in" }]) {
      const { container } = render(<BackendBanner backend={snap(o)} actions={actions()} />);
      expect(container.textContent).toBe("");
      cleanup();
    }
    const { container } = render(<BackendBanner backend={null} />);
    expect(container.textContent).toBe("");
  });

  it("asks the person to sign the cloud in again, and the button does", async () => {
    const a = actions();
    render(<BackendBanner backend={snap({ side: "cloud", state: "cloud_needs_sign_in" })} actions={a} />);
    expect(screen.getByText("Your cloud igni needs you to sign in again.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sign in" })));
    expect(a.calls).toEqual(["signIn"]);
  });

  it("shows a failed sign-in's reason", async () => {
    const a = actions();
    a.signIn = vi.fn(async () => {
      throw new Error("igni server refused the cloud: group_local_only.");
    });
    render(<BackendBanner backend={snap({ side: "cloud", state: "cloud_needs_sign_in" })} actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/group_local_only/);
  });

  it("offers Retry and Use this computer when the cloud is unreachable", async () => {
    const a = actions();
    render(<BackendBanner backend={snap({ side: "cloud", state: "cloud_unreachable", reason: "network" })} actions={a} />);
    expect(screen.getByText("Can't reach your cloud igni. Retrying…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use this computer" })));
    expect(a.calls).toEqual(["retry", "local"]);
  });

  it("offers no way to this computer when the mode is cloud", () => {
    render(<BackendBanner backend={snap({ side: "cloud", state: "cloud_unreachable", reason: "busy", can_use_local: false })} actions={actions()} />);
    expect(screen.getByText("Your cloud is busy. Retrying…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use this computer" })).toBeNull();
  });

  it("names a refusal and, back on this computer, can be dismissed", () => {
    const a = actions();
    render(<BackendBanner backend={snap({ side: "local", state: "refused", reason: "inactive" })} actions={a} />);
    expect(screen.getByRole("status").textContent).toMatch(/not active.*Using this computer instead\./);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(a.calls).toEqual(["dismiss"]);
  });

  it("keeps a refusal on the cloud side without a dismiss", () => {
    render(<BackendBanner backend={snap({ side: "cloud", state: "refused", reason: "not_licensed", can_use_local: false })} actions={actions()} />);
    expect(screen.getByRole("status").getAttribute("data-state")).toBe("refused");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("tells of a mode the organisation changed", () => {
    const { rerender } = render(<BackendBanner backend={snap({ notice: { kind: "moving_to_cloud", approvals: 1 } })} actions={actions()} />);
    expect(screen.getByRole("status").textContent).toMatch(/Switching when the current run ends\. 1 approval/);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    rerender(<BackendBanner backend={snap({ notice: { kind: "moved_to_local" } })} actions={actions()} />);
    expect(screen.getByRole("status").textContent).toMatch(/now runs igni on this computer/);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
});

describe("WakingOverlay", () => {
  it("appears only once the socket has waited 800 ms without a welcome", () => {
    vi.useFakeTimers();
    const { rerender } = render(<WakingOverlay backend={snap({ side: "cloud", state: "waking" })} />);
    expect(screen.queryByText("Waking your cloud igni…")).toBeNull();
    act(() => vi.advanceTimersByTime(WAKING_DELAY_MS - 1));
    expect(screen.queryByText("Waking your cloud igni…")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("Waking your cloud igni…")).toBeTruthy();
    rerender(<WakingOverlay backend={snap({ side: "cloud", state: "cloud_ready" })} />);
    expect(screen.queryByText("Waking your cloud igni…")).toBeNull();
  });

  it("never flashes for a VM that answers in time", () => {
    vi.useFakeTimers();
    const { rerender } = render(<WakingOverlay backend={snap({ side: "cloud", state: "dialing" })} />);
    act(() => vi.advanceTimersByTime(300));
    rerender(<WakingOverlay backend={snap({ side: "cloud", state: "cloud_ready" })} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByText("Waking your cloud igni…")).toBeNull();
  });

  it("is never shown on this computer", () => {
    vi.useFakeTimers();
    render(<WakingOverlay backend={snap({ side: "local", state: "dialing" })} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Waking your cloud igni…")).toBeNull();
  });
});
