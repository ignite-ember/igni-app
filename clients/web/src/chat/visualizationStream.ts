/**
 * FE-side reducer for the visualizer streaming path.
 *
 * BE broadcasts ``visualization_delta`` orchestrate events with the
 * ACCUMULATED JSON string as each ~50ms window closes. This module
 * partial-parses that string into a Spec and reduces it against the
 * items list — first delta creates a card, subsequent deltas update
 * the same card by ``spec_id``.
 *
 * Kept separate from App.tsx so the logic is testable with a
 * scripted delta tape. The App just plumbs events into
 * ``applyVisualizationDelta`` and lets it own the item update.
 */

import type { Spec } from "@json-render/core";
import { parse as parsePartialJson, Allow } from "partial-json";
import { specIssueText } from "../components/jsonRender/specIntegrity";
import type { ChatItem, VisualizationItem } from "./chatItem";
import type { ChatItemFactory } from "./chatItemFactory";

export interface VisualizationDeltaEvent {
  spec_id: string;
  json: string;
  /** ``true`` on the last delta of the stream so callers can trigger
   *  persistence exactly once. */
  final?: boolean;
  /** Which draw of the card this is; the first draw is 1. Absent on a
   *  partial frame, which is not a draw. */
  revision?: number;
  /** The title an extension gave the card (``host.chat.append(view, title)``). */
  title?: string;
  /** The id of the extension that appended the card. Absent on the
   *  visualizer's own cards. */
  source?: string;
}

/** One element of a card the client could not draw. */
export interface VisualizationElementFailure {
  type: string;
  message: string;
}

/** What the client drew of one card, said to the backend. */
export interface VisualizationVerdictReport {
  /** The card this is about. */
  spec_id: string;
  /** Which draw of the card this is; the first draw is 1. */
  revision: number;
  /** How many elements the card has. */
  total: number;
  /** The elements the client could not draw. */
  failed: VisualizationElementFailure[];
  /** What was wrong with the card's shape. */
  issues: string[];
}

/** The ``visualization_delta`` an ``orchestrate_event`` push carries,
 *  or null when the payload is some other orchestrate event. */
export function visualizationDeltaFromPayload(
  payload: unknown,
): VisualizationDeltaEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (
    p.type !== "visualization_delta" ||
    typeof p.spec_id !== "string" ||
    typeof p.json !== "string"
  ) {
    return null;
  }
  return {
    spec_id: p.spec_id,
    json: p.json,
    final: p.final === true,
    revision: typeof p.revision === "number" ? p.revision : undefined,
    title: typeof p.title === "string" ? p.title : undefined,
    source: typeof p.source === "string" && p.source ? p.source : undefined,
  };
}

/** A spec as the Renderer can walk it, and the spec as it arrived. */
export interface PartialSpec {
  /** The spec, pruned to what the Renderer can walk. */
  spec: Spec;
  /** The spec before the pruning: what the gaps are read from. */
  raw: unknown;
}

/**
 * The spec, pruned to what @json-render/react's Renderer can walk.
 *
 * "Safe" means: root resolves to an element in the map, and every
 * child id referenced from an element's ``children`` array also
 * resolves. If either invariant is broken, the Renderer throws
 * (which crashes the surrounding React tree — the bug this
 * function prevents).
 *
 * The pruning is what a broken spec is silently repaired with, so
 * what it took out is read from the spec BEFORE the pruning
 * (``specIntegrity.ts``) and said on the card — otherwise the repair
 * is what hides the gap (R666).
 *
 * Returns null when the spec can't be coerced into a safe one.
 */
export function pruneSpec(spec: unknown): Spec | null {
  if (
    !spec ||
    typeof spec !== "object" ||
    Array.isArray(spec) ||
    !("root" in (spec as Record<string, unknown>)) ||
    !("elements" in (spec as Record<string, unknown>))
  ) {
    return null;
  }
  const root = (spec as { root: unknown }).root;
  const elementsRaw = (spec as { elements: unknown }).elements;
  if (typeof root !== "string" || !root) return null;
  if (
    !elementsRaw ||
    typeof elementsRaw !== "object" ||
    Array.isArray(elementsRaw)
  ) {
    return null;
  }
  const elements = elementsRaw as Record<string, unknown>;
  // Renderer requires ``elements[root]`` to be an object with a
  // ``type`` string. Partial-json may leave it as null or missing.
  const rootEl = elements[root];
  if (
    !rootEl ||
    typeof rootEl !== "object" ||
    Array.isArray(rootEl) ||
    typeof (rootEl as { type?: unknown }).type !== "string"
  ) {
    return null;
  }
  // Prune child-ids that don't yet resolve so a mid-stream Card
  // pointing at ``["chart"]`` doesn't crash when ``chart`` hasn't
  // been streamed in yet. We mutate a shallow copy so the caller's
  // input (the raw partial-json object) is unaffected.
  const safeElements: Record<string, unknown> = {};
  for (const [id, el] of Object.entries(elements)) {
    if (!el || typeof el !== "object" || Array.isArray(el)) continue;
    if (typeof (el as { type?: unknown }).type !== "string") continue;
    const rawChildren = (el as { children?: unknown }).children;
    let children: string[] | undefined;
    if (Array.isArray(rawChildren)) {
      children = rawChildren.filter(
        (c): c is string => typeof c === "string" && c in elements,
      );
    }
    safeElements[id] = children ? { ...el, children } : el;
  }
  if (!safeElements[root]) return null;
  return {
    ...(spec as Record<string, unknown>),
    elements: safeElements,
  } as Spec;
}

/** Attempt to partial-parse the accumulated JSON into a Spec that
 *  is SAFE for @json-render/react's Renderer to walk.
 *
 *  Returns null when the current buffer can't yet be coerced into
 *  a safe spec. Callers keep the previous good spec on screen
 *  until a new safe one arrives — that's what makes progressive
 *  streaming look smooth instead of flickering broken frames.
 */
export function parsePartialSpec(json: string): Spec | null {
  let partial: unknown;
  try {
    partial = parsePartialJson(json, Allow.ALL);
  } catch {
    return null;
  }
  return pruneSpec(partial);
}

/** The accumulated JSON, parsed: the spec the Renderer can walk, and
 *  the spec as it arrived (the gaps are read from that one). */
export function readPartialSpec(json: string): PartialSpec | null {
  let partial: unknown;
  try {
    partial = parsePartialJson(json, Allow.ALL);
  } catch {
    return null;
  }
  const spec = pruneSpec(partial);
  if (!spec) return null;
  return { spec, raw: partial };
}

/** Fold one visualization_delta into the current items list.
 *  Returns the new items list — same reference if nothing changed
 *  (e.g. an early delta that can't yet be partial-parsed). Callers
 *  can shallow-compare and skip re-render. A new card takes its id
 *  from ``factory``, which must be the one the list's other items came from.
 *
 *  On the final delta the spec is whole, so what it leaves out is
 *  said on the card ("its children 'chart' and 'table' are not
 *  elements of it"). Before that, an element may point at an id that
 *  has not arrived yet — that is the stream at work, not a gap — so
 *  nothing is said until the spec is final (R666).
 */
export function applyVisualizationDelta(
  items: ChatItem[],
  event: VisualizationDeltaEvent,
  factory: ChatItemFactory,
): ChatItem[] {
  if (!event.spec_id || typeof event.json !== "string") return items;
  const read = readPartialSpec(event.json);
  if (!read) return items;
  const spec = read.spec;
  const notices = event.final ? specIssueText(read.raw) : undefined;

  const idx = items.findIndex(
    (it) => it.kind === "visualization" && it.specId === event.spec_id,
  );
  const existing = items[idx];
  if (existing?.kind === "visualization") {
    const next = items.slice();
    const updated: VisualizationItem = {
      ...existing,
      spec,
      title: event.title || existing.title,
      ...(notices ? { notices } : {}),
      // The card is whole again once the whole card arrives; until
      // then it is being drawn, and what it drew is not said yet.
      final: event.final === true,
      revision: event.revision ?? existing.revision,
    };
    next[idx] = updated;
    return next;
  }
  return [
    ...items,
    factory.visualization({
      spec,
      title: event.title ?? "",
      sourceAgent: event.source ?? "visualizer",
      specId: event.spec_id,
      fromExtension: event.source,
      ...(notices ? { notices } : {}),
      ...(event.revision !== undefined ? { revision: event.revision } : {}),
      final: event.final === true,
    }),
  ];
}
