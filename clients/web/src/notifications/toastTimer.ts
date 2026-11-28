/** A toast's auto-hide countdown, which a pointer or keyboard focus on the
 *  toast can hold: paused, it keeps what was left and resumes from there. */

/** The clock and the scheduler, injected so tests can drive them. */
export interface TimerClock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
}

const WINDOW_CLOCK: TimerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => Number(globalThis.setTimeout(fn, ms)),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

export class ToastTimer {
  private remaining: number;
  private startedAt = 0;
  private handle: number | null = null;
  private holds = 0;
  private done = false;

  constructor(
    ttlMs: number,
    private readonly onExpire: () => void,
    private readonly clock: TimerClock = WINDOW_CLOCK,
  ) {
    this.remaining = ttlMs;
  }

  /** Whether the countdown is held by a hover or a focus. */
  get paused(): boolean {
    return this.holds > 0;
  }

  /** Start counting down, unless something already holds it. */
  start(): void {
    if (this.done || this.handle !== null || this.paused) return;
    this.startedAt = this.clock.now();
    this.handle = this.clock.setTimeout(() => this.expire(), this.remaining);
  }

  /** Hold the countdown; holds nest (hover and focus at once). */
  pause(): void {
    this.holds += 1;
    if (this.handle === null) return;
    this.clock.clearTimeout(this.handle);
    this.handle = null;
    this.remaining = Math.max(0, this.remaining - (this.clock.now() - this.startedAt));
  }

  /** Release one hold; the last one resumes from what was left. */
  resume(): void {
    if (this.holds === 0) return;
    this.holds -= 1;
    this.start();
  }

  /** Stop for good: the toast is leaving some other way. */
  cancel(): void {
    this.done = true;
    if (this.handle !== null) this.clock.clearTimeout(this.handle);
    this.handle = null;
  }

  private expire(): void {
    this.handle = null;
    this.done = true;
    this.onExpire();
  }
}
