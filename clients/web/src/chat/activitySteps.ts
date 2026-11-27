/**
 * An activity group's items as steps: what each one is, how it went,
 * and the words for it, for the dot strip, the timeline and the live
 * window (components/chatItems/ActivityGroupView.tsx).
 */

import { stepKindOf, type StepKind } from "./activityGroups";
import type { ChatItem, ToolItem } from "./chatItem";

/** How a step went. ``live``: the one the turn is on now. */
export type StepState = "done" | "live" | "failed" | "rejected";

/** What a step is: a tool's kind, or a thought. */
export type StepGlyph = StepKind | "thinking";

export interface ActivityStep {
  /** Where the step sits in its group. */
  index: number;
  item: ChatItem;
  glyph: StepGlyph;
  state: StepState;
  /** The step in a few words: ``Bash npm test``, ``Thought``. */
  label: string;
  /** A finished command's exit code, when its output says it. */
  exitCode: number | null;
}

/** The step a group's ``item`` is, at ``index``; ``live`` when the turn is on it. */
function stepOf(item: ChatItem, index: number, live: boolean): ActivityStep {
  if (item.kind === "tool") {
    const state: StepState = live
      ? "live"
      : item.status === "error"
        ? "failed"
        : item.status === "rejected"
          ? "rejected"
          : "done";
    const label = item.args ? `${item.name} ${item.args}` : item.name;
    const glyph = stepKindOf(item.name);
    const exitCode = glyph === "command" && state !== "live" ? exitCodeOf(item.result) : null;
    return { index, item, glyph, state, label, exitCode };
  }
  if (item.kind === "thinking") {
    const label = live ? "Thinking" : "Thought";
    return { index, item, glyph: "thinking", state: live ? "live" : "done", label, exitCode: null };
  }
  const text = item.kind === "agent" ? item.text : item.kind;
  return { index, item, glyph: "agent", state: live ? "live" : "done", label: text, exitCode: null };
}

/** The ways igni-core's shell tools say how a command exited
 *  (``core/tools/shell.py``, ``process_supervisor.py``). */
const EXIT_CODE = /\bexit(?:ed with)? code[:\s]+(-?\d+)/i;
/** Characters of a result searched for its exit code, at each end. */
const EXIT_SCAN = 200;

/** A command's exit code, from the first or last lines of its output. */
export function exitCodeOf(result: string): number | null {
  const head = result.slice(0, EXIT_SCAN);
  const m = EXIT_CODE.exec(head) ?? (result.length > EXIT_SCAN ? EXIT_CODE.exec(result.slice(-EXIT_SCAN)) : null);
  return m ? Number(m[1]) : null;
}

/** How a step went, in a word or two: ``failed · exit 1``, ``running``. */
export function stepResultText(step: ActivityStep): string | null {
  if (step.glyph === "thinking") return null;
  if (step.state === "live") return step.item.kind === "tool" ? "running" : null;
  if (step.state === "rejected") return "not run";
  if (step.item.kind !== "tool") return null;
  const code = step.exitCode === null ? null : `exit ${step.exitCode}`;
  if (step.state === "failed") return code ? `failed · ${code}` : "failed";
  return code && step.exitCode !== 0 ? `done · ${code}` : "done";
}

/** The group's latest thought, and whether it is still streaming. */
export function latestThought(steps: readonly ActivityStep[]): { text: string; live: boolean } | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.item.kind === "thinking" && s.item.text.trim()) return { text: s.item.text, live: s.state === "live" };
  }
  return null;
}

/** The step a group's row names: the one running, else the last. */
export function headlineStep(steps: readonly ActivityStep[]): ActivityStep | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].state === "live" && steps[i].item.kind === "tool") return steps[i];
  }
  return steps[steps.length - 1] ?? null;
}

/** How many of ``count`` markers a strip ``width`` px wide shows, each
 *  ``slot`` px with ``gap`` px between, keeping ``more`` px for the
 *  "+k" when they do not all fit. An unmeasured strip shows them all. */
export function fitMarkers(width: number, count: number, slot: number, gap: number, more: number): number {
  if (width <= 0 || count * slot + (count - 1) * gap <= width) return count;
  return Math.max(1, Math.floor((width - more + gap) / (slot + gap)));
}

/** The indexes of the steps the turn is on: a tool waiting on its
 *  result, or the last thought or agent marker of a running group. */
export function liveStepIndexes(items: readonly ChatItem[], running: boolean): number[] {
  if (!running) return [];
  const live: number[] = [];
  items.forEach((it, i) => {
    if (it.kind === "tool" && it.status === "running") live.push(i);
  });
  const last = items.length - 1;
  const tail = items[last];
  if (tail && tail.kind !== "tool" && !live.includes(last)) live.push(last);
  return live;
}

/** The steps of a group's ``items``. */
export function activitySteps(items: readonly ChatItem[], running: boolean): ActivityStep[] {
  const live = new Set(liveStepIndexes(items, running));
  return items.map((item, i) => stepOf(item, i, live.has(i)));
}

/** Characters a window reads back from the end; more never shows. */
const TAIL_CHARS = 360;

/**
 * The last ``maxLines`` non-empty lines of ``text``, read from at most
 * its last few hundred characters so a long thought costs the same as a
 * short one. A cut through a word drops that word's first part.
 */
export function tailLines(text: string, maxLines: number): string[] {
  const trimmed = text.replace(/\s+$/, "");
  let tail = trimmed.length > TAIL_CHARS ? trimmed.slice(-TAIL_CHARS) : trimmed;
  if (tail.length < trimmed.length) {
    const cut = tail.search(/\s/);
    if (cut >= 0) tail = tail.slice(cut + 1);
  }
  return tail
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .slice(-maxLines);
}

/** The file an edit tool's ``args`` names: its first word. */
function editedPath(tool: ToolItem): string {
  return tool.args.trim().split(/\s+/)[0] ?? "";
}

/** The files a group's finished edits changed, once each, in order. */
export function editedFiles(items: readonly ChatItem[]): string[] {
  const seen: string[] = [];
  for (const it of items) {
    if (it.kind !== "tool" || it.status !== "done" || stepKindOf(it.name) !== "edit") continue;
    const path = editedPath(it);
    if (path && !seen.includes(path)) seen.push(path);
  }
  return seen;
}

/** The last part of ``path``. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
