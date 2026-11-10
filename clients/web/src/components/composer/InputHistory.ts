/**
 * The messages sent from this composer, for ArrowUp / ArrowDown recall,
 * and where in them the person is.
 *
 * Immutable: each step returns the next history. Entries are wire form
 * (`/help`, `$ ls`), so recalling one re-enters its mode. Starting to
 * browse keeps what was being typed, and walking past the newest entry
 * gives it back.
 */

/** Sent messages kept for recall. */
export const HISTORY_LIMIT = 100;

/** A step through history: the history after it, and the wire-form entry
 *  to put in the composer. */
export interface HistoryStep {
  history: InputHistory;
  entry: string;
}

/** `index` when not browsing. */
const AT_DRAFT = -1;

export class InputHistory {
  private constructor(
    private readonly entries: readonly string[],
    private readonly index: number,
    /** What was being typed when browsing started. */
    private readonly draft: string,
  ) {}

  private static readonly EMPTY = new InputHistory([], AT_DRAFT, "");

  static empty(): InputHistory {
    return InputHistory.EMPTY;
  }

  get size(): number {
    return this.entries.length;
  }

  get browsing(): boolean {
    return this.index !== AT_DRAFT;
  }

  /** `wire` sent: remembered unless it repeats the newest entry. */
  push(wire: string): InputHistory {
    const entries =
      this.entries[this.entries.length - 1] === wire
        ? this.entries
        : [...this.entries, wire].slice(-HISTORY_LIMIT);
    return new InputHistory(entries, AT_DRAFT, this.draft);
  }

  /** One entry older; `currentWire` is kept as the draft when browsing
   *  starts. `null` when there is nothing to recall. */
  prev(currentWire: string): HistoryStep | null {
    if (!this.entries.length) return null;
    const index = this.browsing ? Math.max(0, this.index - 1) : this.entries.length - 1;
    const draft = this.browsing ? this.draft : currentWire;
    return { history: new InputHistory(this.entries, index, draft), entry: this.entries[index] };
  }

  /** One entry newer, or back to the draft past the newest. `null` when
   *  not browsing. */
  next(): HistoryStep | null {
    if (!this.browsing) return null;
    if (this.index < this.entries.length - 1) {
      const index = this.index + 1;
      return { history: new InputHistory(this.entries, index, this.draft), entry: this.entries[index] };
    }
    return { history: new InputHistory(this.entries, AT_DRAFT, this.draft), entry: this.draft };
  }

  /** Stop browsing. The same history when not browsing, so a state update
   *  with it renders nothing. */
  reset(): InputHistory {
    return this.browsing ? new InputHistory(this.entries, AT_DRAFT, this.draft) : this;
  }
}
