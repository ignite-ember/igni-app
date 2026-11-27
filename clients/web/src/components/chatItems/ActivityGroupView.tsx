/**
 * One activity group: a quiet row with the group's progress, and behind
 * it the group's tool cards and thinking blocks as they always render.
 */

import { memo, useEffect, useId, useState } from "react";

import {
  countActivity,
  currentStep,
  summaryText,
  type ActivityCounts,
  type ActivityGroup,
} from "../../chat/activityGroups";
import { activityDisclosure, useActivityOpen, type ActivityDisclosure } from "../../chat/activityDisclosure";
import { ChevronIcon } from "../Icons";
import { ChatItemView } from "./ChatItemView";
import type { ChatItemHandlers } from "./handlers";

/** ``ms`` as a short duration: ``12s``, ``2m 5s``. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

/** Ticks once a second while ``active``, for the elapsed clock. */
function useTicking(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

/** The running group's one-line label: the step it is on. */
function RunningLabel({ items }: { items: ActivityGroup["items"] }) {
  const step = currentStep(items);
  if (step?.kind === "tool") {
    return (
      <>
        <span className="activity-tool-name">{step.item.name}</span>
        {step.item.args && <span className="activity-tool-args">{step.item.args}</span>}
      </>
    );
  }
  if (step?.kind === "agent") return <span className="activity-label-text">{step.text}</span>;
  return <span className="activity-label-text">Thinking…</span>;
}

/** The finished group's summary, with its failures. */
function FinishedLabel({ counts }: { counts: ActivityCounts }) {
  return (
    <>
      <span className="activity-label-text">{summaryText(counts)}</span>
      {counts.failed > 0 && (
        <span className="activity-failed">
          <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true" className="activity-failed-mark">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          {counts.failed} failed
        </span>
      )}
    </>
  );
}

interface ActivityGroupProps {
  group: ActivityGroup;
  /** The turn is still adding to this group. */
  running: boolean;
  /** Open whatever the person chose: a search result sits inside. */
  forceOpen?: boolean;
  /** When the group was first seen running, and stopped; epoch ms. */
  startedAt?: number | null;
  endedAt?: number | null;
  handlers?: ChatItemHandlers;
  store?: ActivityDisclosure;
}

function ActivityGroupViewImpl({
  group,
  running,
  forceOpen = false,
  startedAt = null,
  endedAt = null,
  handlers,
  store = activityDisclosure,
}: ActivityGroupProps) {
  const [open, setOpen] = useActivityOpen(group.key, store);
  const expanded = open || forceOpen;
  const bodyId = useId();
  const now = useTicking(running && startedAt !== null);
  const counts = countActivity(group.items);
  const elapsed = startedAt === null ? null : formatElapsed((endedAt ?? now) - startedAt);
  const failed = counts.failed > 0;
  const steps = `${counts.steps} ${counts.steps === 1 ? "step" : "steps"}`;
  const announcement = running ? "Working" : `${summaryText(counts)}${failed ? `, ${counts.failed} failed` : ""}`;

  return (
    <div
      className={`activity-group${running ? " running" : ""}${failed ? " failed" : ""}${expanded ? " open" : ""}`}
    >
      <button
        type="button"
        className="activity-head"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setOpen(!expanded)}
      >
        <span className={`activity-dot${running ? " live" : ""}`} aria-hidden="true" />
        <span className="activity-label">
          {running ? <RunningLabel items={group.items} /> : <FinishedLabel counts={counts} />}
        </span>
        <span className="activity-meta">
          {steps}
          {elapsed && ` · ${elapsed}`}
        </span>
        <span className="activity-chevron" aria-hidden="true">
          <ChevronIcon size={10} down={expanded} />
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      <div id={bodyId} className="activity-body" hidden={!expanded}>
        {expanded &&
          group.items.map((item) => (
            <div className="activity-step" key={item.id}>
              <ChatItemView item={item} handlers={handlers} />
            </div>
          ))}
      </div>
    </div>
  );
}

const sameItems = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Re-renders when the group's items change by reference, not on every
 *  rebuild of the rows. */
export const ActivityGroupView = memo(ActivityGroupViewImpl, (prev, next) =>
  prev.group.key === next.group.key &&
  sameItems(prev.group.items, next.group.items) &&
  prev.running === next.running &&
  prev.forceOpen === next.forceOpen &&
  prev.startedAt === next.startedAt &&
  prev.endedAt === next.endedAt &&
  prev.handlers === next.handlers &&
  prev.store === next.store,
);
