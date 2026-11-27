/**
 * One activity group: a row naming the step the turn is on (or, once
 * done, what the group did as coloured chips), a marker per step under
 * it, and under those the group's latest thought and a running
 * command's last output lines; behind it the steps as a timeline.
 */

import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { activityDisclosure, useActivityOpen, type ActivityDisclosure } from "../../chat/activityDisclosure";
import { countActivity, summaryText, type ActivityCounts, type ActivityGroup } from "../../chat/activityGroups";
import {
  activitySteps,
  baseName,
  editedFiles,
  fitMarkers,
  headlineStep,
  latestThought,
  liveStepIndexes,
  stepResultText,
  type ActivityStep,
  type StepGlyph,
} from "../../chat/activitySteps";
import type { ChatItem } from "../../chat/chatItem";
import { useFileViewer } from "../pages/files/viewerContext";
import {
  AgentIcon,
  CheckIcon,
  ChevronIcon,
  CommandIcon,
  FileIcon,
  GlobeIcon,
  PencilIcon,
  PlugIcon,
  SearchIcon,
  ThoughtIcon,
  WrenchIcon,
  XIcon,
} from "../Icons";
import { ChatItemView } from "./ChatItemView";
import type { ChatItemHandlers } from "./handlers";
import { LiveWindow } from "./LiveWindow";

/** A marker's width in the strip, and the gap between two; px, as in theme.css. */
export const MARKER_SLOT = 22;
export const MARKER_GAP = 4;
/** Room kept for the "+k" lead-in when the markers do not all fit; px. */
export const MORE_WIDTH = 35;
/** Lines of the latest thought shown while the group runs. */
const THOUGHT_LINES = 3;
/** Lines of the last thought shown once the group is done. */
const DONE_THOUGHT_LINES = 2;
/** Lines of a running command's output shown. */
const OUTPUT_LINES = 2;
/** How long a step picked from its marker stays highlighted. */
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

/** The width of the element the ref holds, kept current; 0 until measured. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** A step's marker tooltip: its label, its time, and how it went. */
export function stepTooltip(step: ActivityStep, duration: string | null): string {
  return [step.label, duration, stepResultText(step)].filter(Boolean).join(" · ");
}

/** A step kind's icon. */
const GLYPH_ICONS: Record<StepGlyph, (size: number) => ReactNode> = {
  command: (s) => <CommandIcon size={s} />,
  read: (s) => <FileIcon size={s} />,
  edit: (s) => <PencilIcon size={s - 1} />,
  search: (s) => <SearchIcon size={s} />,
  fetch: (s) => <GlobeIcon size={s} />,
  mcp: (s) => <PlugIcon size={s} />,
  agent: (s) => <AgentIcon size={s} />,
  other: (s) => <WrenchIcon size={s} />,
  thinking: (s) => <ThoughtIcon size={s} />,
};

/** How a tool step went, as a mark: a check, a cross, a dash; none while live. */
function ResultMark({ step, size }: { step: ActivityStep; size: number }) {
  if (step.item.kind !== "tool" || step.state === "live") return null;
  if (step.state === "failed") return <XIcon size={size} />;
  if (step.state === "rejected") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ display: "block" }}>
        <path d="M4 8h8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  return <CheckIcon size={size} />;
}

/** One step's marker: its kind by colour and icon, how it went by a badge. */
function StepMarker({ step }: { step: ActivityStep }) {
  const badged = step.item.kind === "tool" && step.state !== "live";
  return (
    <span className={`step-marker glyph-${step.glyph} state-${step.state}`} aria-hidden="true">
      {GLYPH_ICONS[step.glyph](11)}
      {badged && (
        <span className="step-badge">
          <ResultMark step={step} size={7} />
        </span>
      )}
    </span>
  );
}

/** The markers under the row: as many as the width holds, the earlier
 *  ones folded into "+k"; a tooltip each, a click opens the step. */
function MarkerStrip({
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
  const [ref, width] = useWidth<HTMLDivElement>();
  const fit = fitMarkers(width, steps.length, MARKER_SLOT, MARKER_GAP, MORE_WIDTH);
  const hidden = steps.length - fit;
  const shown = hidden > 0 ? steps.slice(hidden) : steps;
  const last = shown[shown.length - 1]?.index;
  const earlier = `${hidden} earlier ${hidden === 1 ? "step" : "steps"}`;

  /** Arrow keys walk the markers; Tab leaves the strip. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".step-marker-btn")];
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to =
      e.key === "ArrowRight" ? Math.min(at + 1, btns.length - 1)
      : e.key === "ArrowLeft" ? Math.max(at - 1, 0)
      : e.key === "Home" ? 0
      : e.key === "End" ? btns.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    btns[to].focus();
  };

  return (
    <div ref={ref} className="activity-markers" role="toolbar" aria-label="Steps" onKeyDown={onKeyDown}>
      {hidden > 0 && (
        <button
          type="button"
          className="activity-more"
          tabIndex={-1}
          title={earlier}
          aria-label={earlier}
          onClick={() => onPick(hidden - 1)}
        >
          +{hidden}
        </button>
      )}
      {shown.map((step) => {
        const text = stepTooltip(step, durationOf(step));
        const tipped = tip === step.index;
        return (
          <span className="step-marker-slot" key={step.item.id}>
            <button
              type="button"
              className="step-marker-btn"
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
              <StepMarker step={step} />
            </button>
            {tipped && (
              <span className={`step-tooltip state-${step.state}`} role="tooltip" id={tipId}>
                {text}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The summary's chips, in order: what each counts and how it reads. */
const CHIPS: readonly {
  glyph: StepGlyph;
  count: (c: ActivityCounts) => number;
  one: string;
  many: string;
  /** Marked with a check: the ones that went through. */
  ok?: boolean;
}[] = [
  { glyph: "command", count: (c) => c.commandsOk, one: "command", many: "commands", ok: true },
  { glyph: "read", count: (c) => c.read, one: "file read", many: "files read" },
  { glyph: "edit", count: (c) => c.edit, one: "edited", many: "edited" },
  { glyph: "search", count: (c) => c.search, one: "search", many: "searches" },
  { glyph: "fetch", count: (c) => c.fetch, one: "page", many: "pages" },
  { glyph: "mcp", count: (c) => c.mcp, one: "MCP tool", many: "MCP tools" },
  { glyph: "agent", count: (c) => c.agent, one: "agent", many: "agents" },
  { glyph: "other", count: (c) => c.other, one: "tool", many: "tools" },
  { glyph: "thinking", count: (c) => c.thoughts, one: "thought", many: "thoughts" },
];

/** The finished group: a coloured chip per kind of step, the failures
 *  in red after the commands, the sentence for assistive technology. */
function FinishedLabel({ counts }: { counts: ActivityCounts }) {
  const chips: ReactNode[] = [];
  for (const { glyph, count, one, many, ok } of CHIPS) {
    const n = count(counts);
    if (n === 0) continue;
    chips.push(
      <span className={`activity-chip chip-${glyph}`} key={glyph}>
        {GLYPH_ICONS[glyph](11)}
        <span className="activity-chip-count">{n}</span>
        {ok && (
          <span className="activity-chip-ok">
            <CheckIcon size={9} />
          </span>
        )}
        <span className="activity-chip-word">{n === 1 ? one : many}</span>
      </span>,
    );
  }
  if (counts.failed > 0) {
    // Beside the commands that went through, or first of all.
    chips.splice(
      counts.commandsOk > 0 ? 1 : 0,
      0,
      <span className="activity-chip activity-failed" key="failed">
        <XIcon size={9} />
        {counts.failed} failed
      </span>,
    );
  }
  return (
    <>
      <span className="sr-only">{summaryText(counts)}</span>
      <span className="activity-chips" aria-hidden="true">
        {chips}
      </span>
    </>
  );
}

/** The row's step: how it went, its kind's icon, what it is, and its
 *  time, or its exit code when it failed. */
function HeadlineLabel({ step, duration }: { step: ActivityStep | null; duration: string | null }) {
  if (!step) return <span className="activity-label-text">Working…</span>;
  const kind = (
    <span className={`activity-kind glyph-${step.glyph}${step.state === "live" ? " live" : ""}`} aria-hidden="true">
      {GLYPH_ICONS[step.glyph](12)}
    </span>
  );
  if (step.item.kind !== "tool") {
    const text = step.item.kind === "thinking" ? (step.state === "live" ? "Thinking…" : "Thought") : step.label;
    return (
      <>
        {kind}
        <span className="activity-label-text">{text}</span>
      </>
    );
  }
  const tail =
    step.state === "failed" ? (step.exitCode !== null ? `exit ${step.exitCode}` : "failed")
    : step.state === "rejected" ? "not run"
    : duration;
  return (
    <>
      <span className={`activity-status state-${step.state}`} aria-hidden="true">
        {step.state === "live" ? <span className="activity-live-dot" /> : <ResultMark step={step} size={11} />}
      </span>
      {kind}
      <span className="activity-tool-name">{step.item.name}</span>
      {step.item.args && <span className="activity-tool-args">{step.item.args}</span>}
      {tail && <span className={`activity-step-tail state-${step.state}`}>· {tail}</span>}
    </>
  );
}

/** Under the markers: the latest thought, a few lines of it with the
 *  top one fading, and a running command's last output lines. Once
 *  done, the last thought in two lines, opening to all of the thinking. */
function ThoughtFeed({
  steps,
  running,
  thinkingOpen,
  onToggleThinking,
}: {
  steps: readonly ActivityStep[];
  running: boolean;
  thinkingOpen: boolean;
  onToggleThinking: () => void;
}) {
  const thought = latestThought(steps);
  const liveTool = running ? [...steps].reverse().find((s) => s.state === "live" && s.item.kind === "tool") : undefined;
  const output = liveTool?.item.kind === "tool" ? liveTool.item.result : "";
  if (!thought && !output.trim()) return null;
  const full = thinkingOpen && !running;
  return (
    <div className="activity-feed">
      {thought && (
        <div className={`activity-thought-line${thought.live ? " live" : ""}`}>
          <span className="activity-thought-icon" aria-hidden="true">
            <ThoughtIcon size={12} />
          </span>
          {full ? (
            <div className="activity-thoughts-full">
              {steps.map((s) =>
                s.item.kind === "thinking" && s.item.text.trim() ? <p key={s.item.id}>{s.item.text}</p> : null,
              )}
            </div>
          ) : (
            <LiveWindow
              text={thought.text}
              lines={running ? THOUGHT_LINES : DONE_THOUGHT_LINES}
              className="activity-live"
            />
          )}
          {!running && (
            <button
              type="button"
              className="activity-thinking-toggle"
              aria-expanded={thinkingOpen}
              onClick={onToggleThinking}
            >
              {thinkingOpen ? "Less" : "All thinking"}
            </button>
          )}
        </div>
      )}
      {output.trim() && (
        <div className="activity-output-line">
          <span className="activity-output-icon" aria-hidden="true">
            <CommandIcon size={11} />
          </span>
          <LiveWindow text={output} lines={OUTPUT_LINES} mono className="activity-output" />
        </div>
      )}
    </div>
  );
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
            <PencilIcon size={10} />
            {baseName(path)}
          </button>
        ) : (
          <span key={path} className="activity-file-chip" title={path}>
            <PencilIcon size={10} />
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

/** The steps as a timeline: a marker on a thin line, the card, its time. */
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
      {steps.map((step) => {
        const exit = step.state === "failed" && step.exitCode !== null ? `exit ${step.exitCode}` : null;
        return (
          <li
            key={step.item.id}
            className={`activity-step glyph-${step.glyph} state-${step.state}${flash === step.index ? " flash" : ""}`}
            data-step-index={step.index}
            tabIndex={-1}
          >
            <span className="activity-rail" aria-hidden="true">
              <StepMarker step={step} />
            </span>
            <div className="activity-step-body">
              {step.item.kind === "thinking" ? (
                <ThinkingStep text={step.item.text} live={step.state === "live"} />
              ) : (
                <ChatItemView item={step.item} handlers={handlers} />
              )}
            </div>
            <span className="activity-step-time">
              {exit && <span className="activity-step-exit">{exit}</span>}
              {durationOf(step)}
            </span>
          </li>
        );
      })}
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
  const [thinkingOpen, setThinkingOpen] = useActivityOpen(`${group.key}:thinking`, store);
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
  const headline = running ? headlineStep(steps) : null;

  // A step picked from its marker: once its card is drawn, bring it
  // into view and light it up for a moment.
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
      <button
        type="button"
        className="activity-head"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setOpen(!expanded)}
      >
        <span className="activity-label">
          {running ? (
            <HeadlineLabel step={headline} duration={headline ? durationOf(headline) : null} />
          ) : (
            <FinishedLabel counts={counts} />
          )}
        </span>
        <span className="activity-meta">
          {stepCount}
          {elapsed && ` · ${elapsed}`}
        </span>
        <span className="activity-chevron" aria-hidden="true">
          <ChevronIcon size={10} down={expanded} />
        </span>
      </button>
      <MarkerStrip steps={steps} durationOf={durationOf} onPick={pick} />
      {!expanded && (
        <ThoughtFeed
          steps={steps}
          running={running}
          thinkingOpen={thinkingOpen}
          onToggleThinking={() => setThinkingOpen(!thinkingOpen)}
        />
      )}
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
