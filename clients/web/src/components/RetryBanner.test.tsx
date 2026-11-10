// @vitest-environment jsdom
/**
 * Tests for ``RetryBanner``: a notice per retry attempt, gone after its
 * backoff (plus a settle second) or as soon as the request succeeds, and
 * no timer left behind either way.
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRetryAttemptEvent, HttpRetrySucceededEvent } from "../chat/httpRetryEvents";
import { RetryBanner } from "./RetryBanner";

function attempt(push: { attempt?: number; delaySeconds?: number; url?: string }) {
  act(() => {
    window.dispatchEvent(new HttpRetryAttemptEvent(push));
  });
}

describe("RetryBanner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders nothing until a retry is attempted", () => {
    const { container } = render(<RetryBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the attempt and url, then dismisses after the backoff plus a second", () => {
    render(<RetryBanner />);
    attempt({ attempt: 3, delaySeconds: 2, url: "https://x/y" });
    expect(screen.getByText("Retrying request (attempt 3...)")).toBeTruthy();
    expect(screen.getByText("https://x/y")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2900));
    expect(screen.getByText(/Retrying request/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText(/Retrying request/)).toBeNull();
  });

  it("defaults a missing attempt and backoff instead of dismissing at once", () => {
    render(<RetryBanner />);
    attempt({});
    expect(screen.getByText("Retrying request (attempt 2...)")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText(/Retrying request/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText(/Retrying request/)).toBeNull();
  });

  it("clears every notice and its timers on success", () => {
    render(<RetryBanner />);
    attempt({ attempt: 2, delaySeconds: 5 });
    attempt({ attempt: 3, delaySeconds: 5 });
    expect(screen.getAllByText(/Retrying request/)).toHaveLength(2);
    act(() => {
      window.dispatchEvent(new HttpRetrySucceededEvent());
    });
    expect(screen.queryByText(/Retrying request/)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer running when unmounted", () => {
    const { unmount } = render(<RetryBanner />);
    attempt({ delaySeconds: 5 });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
