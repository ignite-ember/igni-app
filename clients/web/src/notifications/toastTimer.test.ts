import { describe, expect, it, vi } from "vitest";

import { ToastTimer, type TimerClock } from "./toastTimer";

/** A clock the test moves by hand. */
function manualClock() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const clock: TimerClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = next++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending]) {
      if (t.at <= now) {
        pending.delete(id);
        t.fn();
      }
    }
  };
  return { clock, advance, pending };
}

describe("ToastTimer", () => {
  it("expires after its ttl", () => {
    const { clock, advance } = manualClock();
    const expired = vi.fn();
    new ToastTimer(1000, expired, clock).start();
    advance(999);
    expect(expired).not.toHaveBeenCalled();
    advance(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("does not count the time it is paused", () => {
    const { clock, advance } = manualClock();
    const expired = vi.fn();
    const timer = new ToastTimer(1000, expired, clock);
    timer.start();
    advance(600);
    timer.pause();
    expect(timer.paused).toBe(true);
    advance(10_000);
    expect(expired).not.toHaveBeenCalled();
    timer.resume();
    expect(timer.paused).toBe(false);
    advance(399);
    expect(expired).not.toHaveBeenCalled();
    advance(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("stays paused until every hold is released", () => {
    const { clock, advance } = manualClock();
    const expired = vi.fn();
    const timer = new ToastTimer(100, expired, clock);
    timer.start();
    timer.pause();
    timer.pause();
    timer.resume();
    advance(1000);
    expect(expired).not.toHaveBeenCalled();
    timer.resume();
    advance(100);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("ignores a resume with nothing holding it", () => {
    const { clock, advance, pending } = manualClock();
    const expired = vi.fn();
    const timer = new ToastTimer(100, expired, clock);
    timer.start();
    timer.resume();
    expect(pending.size).toBe(1);
    // A stray resume must not let the next pause count for nothing.
    timer.pause();
    expect(timer.paused).toBe(true);
    advance(500);
    expect(expired).not.toHaveBeenCalled();
  });

  it("does not start while held", () => {
    const { clock, advance } = manualClock();
    const expired = vi.fn();
    const timer = new ToastTimer(100, expired, clock);
    timer.pause();
    timer.start();
    advance(500);
    expect(expired).not.toHaveBeenCalled();
  });

  it("starts once however often it is told to", () => {
    const { clock, pending } = manualClock();
    const timer = new ToastTimer(100, () => {}, clock);
    timer.start();
    timer.start();
    expect(pending.size).toBe(1);
  });

  it("never fires once cancelled, and cannot be restarted", () => {
    const { clock, advance } = manualClock();
    const expired = vi.fn();
    const timer = new ToastTimer(100, expired, clock);
    timer.start();
    timer.cancel();
    advance(500);
    timer.start();
    advance(500);
    expect(expired).not.toHaveBeenCalled();
  });

  it("does not restart after it expired", () => {
    const { clock, advance } = manualClock();
    const expired = vi.fn();
    const timer = new ToastTimer(100, expired, clock);
    timer.start();
    advance(100);
    timer.pause();
    timer.resume();
    advance(500);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("uses the window's clock by default", () => {
    vi.useFakeTimers();
    try {
      const expired = vi.fn();
      new ToastTimer(50, expired).start();
      vi.advanceTimersByTime(50);
      expect(expired).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
