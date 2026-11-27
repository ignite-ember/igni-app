/** One background process as the shared card: its command on a toggle
 *  that opens its log, the latest line, its status as a chip, the pid,
 *  elapsed time and start in the footer, and Kill in the action slot
 *  while it runs.
 *  The toggle stretches over the card so a click anywhere opens it; Kill
 *  is its sibling, never nested inside it.
 *
 *  The toggle's name is exactly its visible text, the command (WCAG
 *  2.5.3, R683). */

import { StopIcon } from "../../Icons";
import { Button } from "../../page/Button";
import { CardAction } from "../../page/CardAction";
import { EntityCard } from "../../page/EntityCard";
import { HeroChip } from "../../page/HeroChip";
import type { ProcessRow } from "./processTable";

/** A terminal tile with the process's state as a dot in its corner. */
export function ProcessGlyph({ running, size = 38 }: { running: boolean; size?: number }) {
  const mark = Math.round(size * 0.42);
  return (
    <span className="entity-glyph watcher-glyph" style={{ width: size, height: size }}>
      <svg viewBox="0 0 16 16" width={mark} height={mark} fill="none" aria-hidden="true">
        <path
          d="M3 4.5 6.5 8 3 11.5M8.5 11.5H13"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={`watcher-status watcher-status--${running ? "running" : "stopped"}`} />
    </span>
  );
}

/** "running" while it runs, "exit N" once it stops. */
export function processStatus(row: ProcessRow): string {
  return row.isRunning ? "running" : row.statusLabel(0);
}

/** The wall-clock time a process started, as hours and minutes. */
export function startedClock(startedAt: number): string {
  return new Date(startedAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Kill on a process's own page: the quiet red page button. */
export function KillButton({ onKill }: { onKill: () => void }) {
  return (
    <Button variant="danger" icon={<StopIcon size={11} />} onClick={onKill} title="Send SIGTERM">
      Kill
    </Button>
  );
}

export function WatcherRow({
  row,
  now,
  onToggle,
  onKill,
}: {
  row: ProcessRow;
  now: number;
  onToggle: () => void;
  onKill: () => void;
}) {
  return (
    <EntityCard
      className={`watcher-row${row.isRunning ? "" : " watcher-row--stopped"}`}
      icon={<ProcessGlyph running={row.isRunning} />}
      name={
        <button type="button" className="watcher-row-toggle" aria-expanded={false} onClick={onToggle}>
          <span className="watcher-cmd" title={row.cmd}>
            {row.cmd}
          </span>
        </button>
      }
      action={
        row.isRunning ? (
          <CardAction label="Kill" title="Send SIGTERM" danger className="watcher-kill" onClick={onKill}>
            <StopIcon size={11} />
          </CardAction>
        ) : null
      }
      description={
        row.lastLine ? (
          <span className="watcher-lastline" title={row.lastLine}>
            {row.lastLine}
          </span>
        ) : undefined
      }
      chips={<HeroChip>{processStatus(row)}</HeroChip>}
      footer={
        <>
          <span className="entity-meta watcher-pid">PID {row.pid}</span>
          {row.isRunning && <span className="entity-meta watcher-elapsed">{row.statusLabel(now)}</span>}
          <span className="entity-meta">started {startedClock(row.startedAt)}</span>
        </>
      }
    />
  );
}
