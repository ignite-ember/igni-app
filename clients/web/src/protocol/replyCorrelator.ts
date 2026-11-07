/**
 * Which caller a backend frame belongs to, by its ``id``.
 *
 * A request waits for exactly one frame carrying its id; a stream takes
 * every frame with its id until ``stream_end``. A frame neither claims
 * is uncorrelated, and the client fans it out to its listeners.
 */

import type { ServerMessage, StreamEnd } from "./messages";

export type StreamHandler = (msg: ServerMessage) => void;

interface Waiter {
  resolve: (m: ServerMessage) => void;
  reject: (e: Error) => void;
  timer: number;
}

export class ReplyCorrelator {
  private readonly waiters = new Map<string, Waiter>();
  private readonly streams = new Map<string, StreamHandler>();

  /**
   * Wait for the one frame carrying ``id``, then ``send``. A send that
   * throws (no socket) takes its waiter and timer with it rather than
   * leaving them registered for the full timeout — one per attempt from
   * a panel polling a backend that is down.
   */
  request(
    id: string,
    send: () => void,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiters.delete(id);
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      this.waiters.set(id, { resolve, reject, timer });
      try {
        send();
      } catch (e) {
        clearTimeout(timer);
        this.waiters.delete(id);
        reject(e);
      }
    });
  }

  /** Hand every frame carrying ``id`` to ``onMessage``, then ``send``;
   *  resolves on ``stream_end``. */
  stream(id: string, send: () => void, onMessage: StreamHandler): Promise<void> {
    return new Promise((resolve, reject) => {
      this.streams.set(id, (m) => {
        if (m.type === "stream_end") {
          this.streams.delete(id);
          resolve();
          return;
        }
        onMessage(m);
      });
      try {
        send();
      } catch (e) {
        this.streams.delete(id);
        reject(e);
      }
    });
  }

  /** Give ``msg`` to the request or stream it answers; false when it
   *  answers none. A request outranks a stream with the same id. */
  deliver(msg: ServerMessage): boolean {
    const id = msg.id ?? "";
    if (!id) return false;
    const waiter = this.waiters.get(id);
    if (waiter) {
      this.waiters.delete(id);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
      return true;
    }
    const stream = this.streams.get(id);
    if (stream) {
      stream(msg);
      return true;
    }
    return false;
  }

  /** The connection is gone: reject every request, and end every
   *  stream so awaiting callers resolve and the UI unblocks rather than
   *  hanging on a dead socket. */
  failAll(err: Error): void {
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
    this.waiters.clear();
    for (const [id, fn] of this.streams) {
      const end: StreamEnd = { type: "stream_end", id };
      fn(end);
    }
    this.streams.clear();
  }
}
