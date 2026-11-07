/** One background process in the watcher list: status, pid, elapsed
 *  time or exit code, its command and its latest line on a toggle
 *  button that opens or closes its log, and a Kill button beside it
 *  while it runs. The two buttons are siblings, never nested. */

import type { ProcessRow } from "./processTable";

export function WatcherRow({
  row,
  selected,
  now,
  onToggle,
  onKill,
}: {
  row: ProcessRow;
  selected: boolean;
  now: number;
  onToggle: () => void;
  onKill: () => void;
}) {
  const state = row.isRunning ? "running" : "stopped";

  return (
    <li
      className={`watcher-row${selected ? " watcher-row--selected" : ""}${
        row.isRunning ? "" : " watcher-row--stopped"
      }`}
    >
      <button
        type="button"
        className="watcher-row-toggle"
        aria-expanded={selected}
        aria-label={`PID ${row.pid}: ${row.cmd}`}
        onClick={onToggle}
      >
        <span className="watcher-row-head">
          <span className={`watcher-status watcher-status--${state}`} aria-hidden="true" />
          <span className="watcher-pid">PID {row.pid}</span>
          <span className="watcher-elapsed">{row.statusLabel(now)}</span>
        </span>
        <span className="watcher-cmd" title={row.cmd}>
          {row.cmd}
        </span>
        {row.lastLine ? (
          <span className="watcher-lastline" title={row.lastLine}>
            {row.lastLine}
          </span>
        ) : null}
      </button>
      {row.isRunning ? (
        <button type="button" className="btn btn-sm btn-danger" onClick={onKill} title="Send SIGTERM">
          Kill
        </button>
      ) : null}
    </li>
  );
}
