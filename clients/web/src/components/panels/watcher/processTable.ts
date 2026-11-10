/**
 * What the watcher knows about the background processes: one row per
 * pid and a bounded log buffer for each. Immutable; every change
 * returns a new table, so it can sit in React state as it is.
 */

import type { ListedProcess, ProcessEvent, ProcessEventOf, ProcessTail } from "./processWire";

/** Per-process log cap, matching the backend reader's own buffer bound.
 *  Past it the oldest half is dropped. */
export const LOG_LINE_CAP = 2000;

export class ProcessRow {
  constructor(
    readonly pid: number,
    readonly cmd: string,
    /** Epoch seconds. */
    readonly startedAt: number,
    readonly isRunning: boolean,
    readonly exitCode: number | null,
    /** The latest output line, for the summary list. */
    readonly lastLine: string,
  ) {}

  withLastLine(line: string): ProcessRow {
    return new ProcessRow(this.pid, this.cmd, this.startedAt, this.isRunning, this.exitCode, line);
  }

  withState(isRunning: boolean, exitCode: number | null): ProcessRow {
    return new ProcessRow(this.pid, this.cmd, this.startedAt, isRunning, exitCode, this.lastLine);
  }

  /** Elapsed time while running, the exit code once stopped. */
  statusLabel(now: number): string {
    return this.isRunning ? formatElapsed(now - this.startedAt) : `exit ${this.exitCode ?? "?"}`;
  }
}

export function formatElapsed(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "—";
  if (secs < 60) return `${Math.floor(secs)}s`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}m${s.toString().padStart(2, "0")}s`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h${m.toString().padStart(2, "0")}m`;
}

type EventHandlers = {
  [K in ProcessEvent["channel"]]: (table: ProcessTable, ev: ProcessEventOf<K>) => ProcessTable;
};

const ON_EVENT: EventHandlers = {
  process_started: (t, ev) =>
    t.rows.has(ev.pid) ? t : t.withRow(new ProcessRow(ev.pid, ev.cmd, ev.startedAt, true, null, "")),
  process_line: (t, ev) => {
    const lines = t.logsOf(ev.pid);
    const kept = lines.length >= LOG_LINE_CAP ? lines.slice(LOG_LINE_CAP / 2) : lines;
    const logged = t.withLogs(ev.pid, [...kept, ev.line]);
    const row = t.rows.get(ev.pid);
    return row ? logged.withRow(row.withLastLine(ev.line)) : logged;
  },
  process_exited: (t, ev) => {
    const row = t.rows.get(ev.pid);
    return row ? t.withRow(row.withState(false, ev.exitCode)) : t;
  },
};

export class ProcessTable {
  static readonly EMPTY = new ProcessTable(new Map(), new Map());

  private constructor(
    readonly rows: ReadonlyMap<number, ProcessRow>,
    private readonly logs: ReadonlyMap<number, readonly string[]>,
  ) {}

  logsOf(pid: number): readonly string[] {
    return this.logs.get(pid) ?? [];
  }

  /** Running first, then the most recently started. */
  get sorted(): ProcessRow[] {
    return Array.from(this.rows.values()).sort((a, b) => {
      if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
      return b.startedAt - a.startedAt;
    });
  }

  get runningCount(): number {
    let n = 0;
    for (const row of this.rows.values()) if (row.isRunning) n++;
    return n;
  }

  /** The title's count. With nothing running it names only the stopped
   *  rows, so it never reads "0 running" above a list of them. */
  get countLabel(): string {
    const total = this.rows.size;
    const running = this.runningCount;
    if (total === 0) return "(no processes)";
    if (running === 0) return `(${total} stopped)`;
    return total > running ? `(${running} running, ${total - running} stopped)` : `(${running} running)`;
  }

  /**
   * Takes the backend's list as authoritative for each row's state,
   * keeping the ``lastLine`` only pushes know. A pid in ``knownAtFetch``
   * the list no longer has belonged to a backend that is gone, so it is
   * marked stopped with an unknown code. Pids that arrived after the
   * fetch started are newer than the list and left alone.
   */
  seeded(listed: readonly ListedProcess[], knownAtFetch: ReadonlySet<number>, now: number): ProcessTable {
    const rows = new Map(this.rows);
    for (const p of listed) {
      const lastLine = rows.get(p.pid)?.lastLine ?? "";
      rows.set(p.pid, new ProcessRow(p.pid, p.cmd, now - p.elapsedSeconds, p.isRunning, p.exitCode, lastLine));
    }
    const listedPids = new Set(listed.map((p) => p.pid));
    for (const pid of knownAtFetch) {
      const row = rows.get(pid);
      if (row?.isRunning && !listedPids.has(pid)) rows.set(pid, row.withState(false, null));
    }
    return new ProcessTable(rows, this.logs);
  }

  apply(ev: ProcessEvent): ProcessTable {
    const handle = ON_EVENT[ev.channel] as (t: ProcessTable, ev: ProcessEvent) => ProcessTable;
    return handle(this, ev);
  }

  /** Puts a fetched tail before any lines pushed while it was in flight,
   *  and takes its state for the row. */
  withTail(pid: number, tail: ProcessTail): ProcessTable {
    const logged = this.withLogs(pid, [...tail.lines, ...this.logsOf(pid)]);
    const row = this.rows.get(pid);
    return row ? logged.withRow(row.withState(tail.isRunning, tail.exitCode)) : logged;
  }

  withRow(row: ProcessRow): ProcessTable {
    const rows = new Map(this.rows);
    rows.set(row.pid, row);
    return new ProcessTable(rows, this.logs);
  }

  withLogs(pid: number, lines: readonly string[]): ProcessTable {
    const logs = new Map(this.logs);
    logs.set(pid, lines);
    return new ProcessTable(this.rows, logs);
  }
}
