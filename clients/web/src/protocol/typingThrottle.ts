/**
 * Trailing-edge throttle for the live composer draft (mirroring): at
 * most one flush per interval, and always the latest value, so other
 * views never display a stale draft.
 */

export class TypingThrottle {
  private timer: number | null = null;
  private pending: string | null = null;

  constructor(
    private readonly flush: (text: string) => void,
    private readonly intervalMs = 100,
  ) {}

  push(text: string): void {
    this.pending = text;
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.pending === null) return;
      const value = this.pending;
      this.pending = null;
      this.flush(value);
    }, this.intervalMs);
  }
}
