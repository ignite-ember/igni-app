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
    return { index, item, glyph: stepKindOf(item.name), state, label };
  }
  if (item.kind === "thinking") {
    return { index, item, glyph: "thinking", state: live ? "live" : "done", label: live ? "Thinking" : "Thought" };
  }
  const text = item.kind === "agent" ? item.text : item.kind;
  return { index, item, glyph: "agent", state: live ? "live" : "done", label: text };
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

/** The steps a strip of ``max`` dots shows, and how many earlier ones it leaves out. */
export function visibleSteps<T>(steps: readonly T[], max: number): { hidden: number; shown: readonly T[] } {
  if (steps.length <= max) return { hidden: 0, shown: steps };
  // One slot goes to the "+k" lead-in.
  const keep = Math.max(1, max - 1);
  return { hidden: steps.length - keep, shown: steps.slice(-keep) };
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
