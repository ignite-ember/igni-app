/**
 * One activity group: a quiet row with a dot per step, the step the turn
 * is on (with the last lines of its thought or output under it) or, once
 * done, what the group did as counts; behind it the steps as a timeline.
 */

import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { activityDisclosure, useActivityOpen, type ActivityDisclosure } from "../../chat/activityDisclosure";
import {
  countActivity,
  currentStep,
  summaryText,
  type ActivityCounts,
  type ActivityGroup,
} from "../../chat/activityGroups";
import {
  activitySteps,
  baseName,
  editedFiles,
  liveStepIndexes,
  visibleSteps,
  type ActivityStep,
  type StepGlyph,
} from "../../chat/activitySteps";
import type { ChatItem } from "../../chat/chatItem";
import { useFileViewer } from "../pages/files/viewerContext";
import {
  AgentIcon,
  ChevronIcon,
  FileIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  ThoughtIcon,
  WrenchIcon,
} from "../Icons";
import { ChatItemView } from "./ChatItemView";
import type { ChatItemHandlers } from "./handlers";
import { LiveWindow } from "./LiveWindow";

/** Dots the collapsed row shows before it folds the earlier ones into "+k". */
export const STRIP_MAX = 12;
/** Lines of a thought the windows show. */
const THOUGHT_LINES = 3;
/** Lines of a running command's output the window shows. */
const OUTPUT_LINES = 2;
/** How long a step picked from its dot stays highlighted. */
const FLASH_MS = 1600;

/** ``ms`` as a short duration: ``12s``, ``2m 5s``. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

/** A step's time: as ``formatElapsed``, with ``<1s`` for a quick one. */
export function formatStepTime(ms: number): string {
  return ms < 1000 ? "<1s" : formatElapsed(ms);
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

/** What a step's state reads as, after its label and time. */
const STATE_WORDS: Partial<Record<ActivityStep["state"], string>> = {
  failed: "failed",
  rejected: "not run",
};

/** A step's dot tooltip: its label, its time, and how it went. */
export function stepTooltip(step: ActivityStep, duration: string | null): string {
  const word = step.state === "live" && step.item.kind === "tool" ? "running" : STATE_WORDS[step.state];
  return [step.label, duration, word].filter(Boolean).join(" · ");
}

/** One step's dot: its shape says what it is, its colour how it went. */
function StepDot({ step }: { step: ActivityStep }) {
  return <span className={`step-dot glyph-${step.glyph} state-${step.state}`} aria-hidden="true" />;
}

/** The dots of the collapsed row: a tooltip each, a click opens the step. */
function DotStrip({
  steps,
  durationOf,
  onPick,
}: {
  steps: readonly ActivityStep[];
  durationOf: (step: ActivityStep) => string | null;
  onPick: (index: number) => void;
}) {
  const [tip, setTip] = useState<number | null>(null);
  const tipId = useId();
  const { hidden, shown } = visibleSteps(steps, STRIP_MAX);
  const last = shown[shown.length - 1]?.index;

  /** Arrow keys walk the dots; Tab leaves the strip. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dots = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".step-dot-btn")];
    const at = dots.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to =
      e.key === "ArrowRight" ? Math.min(at + 1, dots.length - 1)
      : e.key === "ArrowLeft" ? Math.max(at - 1, 0)
      : e.key === "Home" ? 0
      : e.key === "End" ? dots.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    dots[to].focus();
  };

  return (
    <div className="activity-dots" role="toolbar" aria-label="Steps" onKeyDown={onKeyDown}>
      {hidden > 0 && (
        <span className="activity-dots-more" title={`${hidden} earlier ${hidden === 1 ? "step" : "steps"}`}>
          +{hidden}
        </span>
      )}
      {shown.map((step) => {
        const text = stepTooltip(step, durationOf(step));
        const tipped = tip === step.index;
        return (
          <span className="step-dot-slot" key={step.item.id}>
            <button
              type="button"
              className="step-dot-btn"
              tabIndex={step.index === last ? 0 : -1}
              aria-label={text}
              aria-describedby={tipped ? tipId : undefined}
              data-step-index={step.index}
              onMouseEnter={() => setTip(step.index)}
              onMouseLeave={() => setTip((t) => (t === step.index ? null : t))}
              onFocus={() => setTip(step.index)}
              onBlur={() => setTip((t) => (t === step.index ? null : t))}
              onClick={() => onPick(step.index)}
            >
              <StepDot step={step} />
            </button>
            {tipped && (
              <span className="step-tooltip" role="tooltip" id={tipId}>
                {text}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** A step kind's icon. */
const GLYPH_ICONS: Record<StepGlyph, () => ReactNode> = {
  command: () => <TerminalIcon size={12} />,
  read: () => <FileIcon size={12} />,
  edit: () => <PencilIcon size={11} />,
  search: () => <SearchIcon size={12} />,
  fetch: () => <GlobeIcon size={12} />,
  agent: () => <AgentIcon size={12} />,
  other: () => <WrenchIcon size={12} />,
  thinking: () => <ThoughtIcon size={12} />,
};

/** The summary's chips, in order: what each counts and how it reads. */
const CHIPS: readonly { glyph: StepGlyph; count: (c: ActivityCounts) => number; one: string; many: string }[] = [
  { glyph: "command", count: (c) => c.command, one: "command", many: "commands" },
  { glyph: "read", count: (c) => c.read, one: "file read", many: "files read" },
  { glyph: "edit", count: (c) => c.edit, one: "file edited", many: "files edited" },
  { glyph: "search", count: (c) => c.search, one: "search", many: "searches" },
  { glyph: "fetch", count: (c) => c.fetch, one: "page fetched", many: "pages fetched" },
  { glyph: "agent", count: (c) => c.agent, one: "agent", many: "agents" },
  { glyph: "other", count: (c) => c.other, one: "other tool", many: "other tools" },
  { glyph: "thinking", count: (c) => c.thoughts, one: "thought", many: "thoughts" },
];

/** The finished group: an icon and a count per kind of step, the
 *  sentence for assistive technology. */
function FinishedLabel({ counts }: { counts: ActivityCounts }) {
  return (
    <>
      <span className="sr-only">{summaryText(counts)}</span>
      <span className="activity-chips" aria-hidden="true">
        {CHIPS.map(({ glyph, count, one, many }) => {
          const n = count(counts);
          if (!n) return null;
          return (
            <span className={`activity-chip chip-${glyph}`} key={glyph} title={`${n} ${n === 1 ? one : many}`}>
              {GLYPH_ICONS[glyph]()}
              <span className="activity-chip-count">{n}</span>
            </span>
          );
        })}
      </span>
      {counts.failed > 0 && (
        <span className="activity-chip activity-failed">
          <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true" className="activity-failed-mark">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          {counts.failed} failed
        </span>
      )}
    </>
  );
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

/** The last lines of the live step under the collapsed row: its thought
 *  as it streams, or its command's output; nothing once it ends. */
function LiveTail({ steps }: { steps: readonly ActivityStep[] }) {
  const live = [...steps].reverse().find((s) => s.state === "live");
  if (!live) return null;
  if (live.item.kind === "thinking") {
    return <LiveWindow text={live.item.text} lines={THOUGHT_LINES} className="activity-live" />;
  }
  if (live.item.kind === "tool" && live.item.result) {
    return <LiveWindow text={live.item.result} lines={OUTPUT_LINES} mono className="activity-live" />;
  }
  return null;
}

/** The files the group edited, each opening in the file viewer. */
function EditedFiles({ paths }: { paths: readonly string[] }) {
  const viewer = useFileViewer();
  return (
    <div className="activity-files">
      <span className="activity-files-label">Edited</span>
      {paths.map((path) =>
        viewer ? (
          <button
            type="button"
            key={path}
            className="activity-file-chip"
            title={`Open ${path}`}
            aria-label={`Open ${path}`}
            onClick={() => viewer.open(path)}
          >
            <FileIcon size={11} />
            {baseName(path)}
          </button>
        ) : (
          <span key={path} className="activity-file-chip" title={path}>
            <FileIcon size={11} />
            {baseName(path)}
          </span>
        ),
      )}
    </div>
  );
}

/** A thought in the timeline: its last lines until opened, all of it then. */
const ThinkingStep = memo(function ThinkingStep({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="activity-thought">
      <button type="button" className="thinking-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronIcon size={9} down={open} /> {live ? "Thinking…" : "Thought"}
      </button>
      {open ? (
        <div className="msg-thinking">{text}</div>
      ) : (
        <LiveWindow text={text} lines={THOUGHT_LINES} className="activity-thought-preview" />
      )}
    </div>
  );
});

/** The steps as a timeline: a dot on a thin line, the card, its time. */
function Timeline({
  steps,
  durationOf,
  flash,
  handlers,
}: {
  steps: readonly ActivityStep[];
  durationOf: (step: ActivityStep) => string | null;
  flash: number | null;
  handlers?: ChatItemHandlers;
}) {
  return (
    <ol className="activity-timeline">
      {steps.map((step) => (
        <li
          key={step.item.id}
          className={`activity-step glyph-${step.glyph} state-${step.state}${flash === step.index ? " flash" : ""}`}
          data-step-index={step.index}
          tabIndex={-1}
        >
          <span className="activity-rail" aria-hidden="true">
            <StepDot step={step} />
          </span>
          <div className="activity-step-body">
            {step.item.kind === "thinking" ? (
              <ThinkingStep text={step.item.text} live={step.state === "live"} />
            ) : (
              <ChatItemView item={step.item} handlers={handlers} />
            )}
          </div>
          <span className="activity-step-time">{durationOf(step)}</span>
        </li>
      ))}
    </ol>
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
  const [flash, setFlash] = useState<{ index: number; at: number } | null>(null);
  const expanded = open || forceOpen;
  const bodyId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const now = useTicking(running && startedAt !== null);
  const counts = countActivity(group.items);
  const steps = useMemo(() => {
    // The list clocks the steps too, for a group scrolled out of view;
    // this keeps a group drawn on its own (a test, a demo) clocked.
    store.stepClocks(group.key, liveStepIndexes(group.items, running), Date.now());
    return activitySteps(group.items, running);
  }, [store, group.key, group.items, running]);
  const durationOf = (step: ActivityStep): string | null => {
    const t = store.stepTime(group.key, step.index);
    return t ? formatStepTime((t.end ?? now) - t.start) : null;
  };
  const elapsed = startedAt === null ? null : formatElapsed((endedAt ?? now) - startedAt);
  const failed = counts.failed > 0;
  const stepCount = `${counts.steps} ${counts.steps === 1 ? "step" : "steps"}`;
  const announcement = running ? "Working" : `${summaryText(counts)}${failed ? `, ${counts.failed} failed` : ""}`;
  const files = running ? [] : editedFiles(group.items);

  // A step picked from its dot: once its card is drawn, bring it into
  // view and light it up for a moment.
  useEffect(() => {
    if (!flash || !expanded) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`.activity-step[data-step-index="${flash.index}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: "nearest" });
    }
    const t = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flash, expanded]);

  const pick = (index: number) => {
    if (!expanded) setOpen(true);
    setFlash({ index, at: Date.now() });
  };

  return (
    <div
      ref={rootRef}
      className={`activity-group${running ? " running" : ""}${failed ? " failed" : ""}${expanded ? " open" : ""}`}
    >
      <div className="activity-head-row">
        <DotStrip steps={steps} durationOf={durationOf} onPick={pick} />
        <button
          type="button"
          className="activity-head"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setOpen(!expanded)}
        >
          <span className="activity-label">
            {running ? <RunningLabel items={group.items} /> : <FinishedLabel counts={counts} />}
          </span>
          <span className="activity-meta">
            {stepCount}
            {elapsed && ` · ${elapsed}`}
          </span>
          <span className="activity-chevron" aria-hidden="true">
            <ChevronIcon size={10} down={expanded} />
          </span>
        </button>
      </div>
      {running && !expanded && <LiveTail steps={steps} />}
      {files.length > 0 && !expanded && <EditedFiles paths={files} />}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      <div id={bodyId} className="activity-body" hidden={!expanded}>
        {expanded && (
          <Timeline steps={steps} durationOf={durationOf} flash={flash?.index ?? null} handlers={handlers} />
        )}
      </div>
    </div>
  );
}

const sameItems = (a: readonly ChatItem[], b: readonly ChatItem[]): boolean =>
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
