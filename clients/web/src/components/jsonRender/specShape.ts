/**
 * The shapes a spec may arrive in.
 *
 * The catalog declares every array-valued prop as a list, and the
 * visualizer's prompt is generated from that catalog — so a spec that
 * follows the prompt has plain lists. A model igni does not fine-tune
 * (igni lets people bring their own model through igni-server's
 * proxies) writes the same array inside an object under a single
 * ``item`` key instead, and the renderer then has nothing to draw: a
 * chart's data is an object where the chart wants a list, and the card
 * says "Could not draw BarGraph: its data is not a list" over a
 * request that was answered (R666).
 *
 * The wrapper is read here as the list it stands for, so the card
 * draws. Only the wrapper is forgiven: anything else that is not a
 * list stays what it is, and the component's own guard still says
 * what it could not draw — a spec that is broken in some other way
 * must not look like one that drew.
 *
 * The pass is deliberately shallow in one place: a list is never
 * walked. The rows of a table are data, and a row that has an ``item``
 * of its own keeps it.
 */

import type { Spec, UIElement } from "@json-render/core";

/** A dict of one key, ``item``, holding a list. */
function isWrappedList(value: unknown): value is { item: unknown[] } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1) return false;
  const [key, inner] = entries[0];
  return key === "item" && Array.isArray(inner);
}

/**
 * A value as the renderer reads it.
 *
 * A wrapped list becomes the list it stands for. A dict is walked, so
 * a wrapper nested in one is found too; the same dict comes back
 * unchanged when nothing in it was wrapped, so a spec that needs no
 * fixing is the spec the renderer already saw.
 */
function asValue(value: unknown): unknown {
  if (isWrappedList(value)) return value.item;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const fixed = asValue(inner);
    if (fixed !== inner) changed = true;
    out[key] = fixed;
  }
  return changed ? out : value;
}

/** An element's props, with a wrapped list unwrapped. */
function asProps(props: unknown): Record<string, unknown> {
  if (props === null || typeof props !== "object" || Array.isArray(props)) return {};
  const entries = Object.entries(props as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  let changed = false;
  for (const [name, value] of entries) {
    const fixed = asValue(value);
    if (fixed !== value) changed = true;
    out[name] = fixed;
  }
  return changed ? out : (props as Record<string, unknown>);
}

/** One element, with a wrapped list in its props or children unwrapped. */
function asElement(element: UIElement): UIElement {
  const props = asProps(element.props);
  const children = element.children === undefined ? undefined : asValue(element.children);
  if (props === element.props && children === element.children) return element;
  return {
    ...element,
    props,
    ...(children === undefined ? {} : { children: children as string[] }),
  };
}

/**
 * A spec whose wrapped lists are the lists they stand for.
 *
 * The same spec comes back when it needs no fixing, so a card that
 * was already drawable is not redrawn because of this pass.
 */
export function normaliseSpec(spec: Spec): Spec {
  const source = spec as unknown as Record<string, unknown>;
  const elements = source.elements;
  if (elements === null || typeof elements !== "object" || Array.isArray(elements)) return spec;
  const out: Record<string, UIElement> = {};
  let changed = false;
  for (const [id, element] of Object.entries(elements as Record<string, UIElement>)) {
    const fixed = asElement(element);
    if (fixed !== element) changed = true;
    out[id] = fixed;
  }
  const state = source.state;
  const fixedState = state === undefined ? undefined : asValue(state);
  if (!changed && fixedState === state) return spec;
  return {
    ...(spec as unknown as Record<string, unknown>),
    elements: out,
    ...(fixedState === undefined ? {} : { state: fixedState }),
  } as unknown as Spec;
}
