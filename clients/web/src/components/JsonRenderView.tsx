/**
 * JsonRenderView — mounts a json-render spec inside the chat stream.
 *
 * The BE's ``visualizer`` sub-agent produces a flat-tree spec
 * (``{ root, elements }``). It arrives as a STREAM, not a finished
 * object: ``orchestrate_agent_stream.py`` emits the accumulated JSON
 * as ``visualization_delta`` events on the ``orchestrate_event`` push
 * channel, and ``chat/visualizationStream.ts`` partial-parses each
 * delta into a new spec on a ``visualization`` chat item, which
 * ``VisualizationCard`` renders by mounting this component.
 *
 * - **The catalog and registry own the components.** Every component
 *   definition lives in ``jsonRender/catalog.ts``; their React
 *   implementations are bound to it in ``jsonRender/registry.tsx``.
 * - **The @json-render/react library owns rendering.** ``<Renderer>``
 *   walks the spec and re-renders an element when its content changes
 *   (it compares elements structurally, so a data array growing
 *   mid-stream redraws its chart); ``JSONUIProvider`` supplies state and
 *   action handlers.
 * - **Actions round-trip through the BE.** The ``handlers`` proxy on
 *   ``JSONUIProvider`` forwards every fired action to the parent
 *   ``onDispatchAction`` callback, which is wired to the
 *   ``dispatch_visualization_action`` RPC.
 * - **The spec's shape is read, not policed.** ``jsonRender/specShape.ts``
 *   reads a wrapped array as the list it stands for, so a model that
 *   writes ``{"item": [...]}`` gets the chart it asked for.
 * - **What the spec leaves out is said.** The chat layer reads the
 *   gaps in the spec before pruning it to what the renderer can walk
 *   (``jsonRender/specIntegrity.ts``) and passes them down as
 *   ``notices``: a card that could not draw everything says so
 *   instead of being quietly blank.
 * - **What the card drew is said back.** The boundary that catches a
 *   failed element tells this view, and this view reports the draw
 *   (``onDrawResult``): the backend keeps it and the agent is told
 *   what is on the screen rather than what it hoped for (R666).
 */

import { Renderer, JSONUIProvider } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { ElementFailureContext, type ElementDrawFailure } from "./jsonRender/guarded";
import { registry, unknownComponent } from "./jsonRender/registry";
import { normaliseSpec } from "./jsonRender/specShape";
import "./JsonRenderView.css";

export type DispatchAction = (name: string, params: Record<string, unknown>) => Promise<unknown>;

type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

/** What the client drew of one card. */
export interface CardDrawResult {
  /** How many elements the card has. */
  total: number;
  /** The elements the client could not draw. */
  failed: ElementDrawFailure[];
  /** What was wrong with the card's shape. */
  issues: string[];
}

interface JsonRenderViewProps {
  spec: Spec;
  title?: string;
  sourceAgent?: string;
  /** What the card could not draw, in words — read from the spec
   *  before it was pruned to what the renderer can walk (R666). */
  notices?: string[];
  onDispatchAction?: DispatchAction;
  /** What this card drew, said once the draw is on the screen. */
  onDrawResult?: (result: CardDrawResult) => void;
}

/** ``JSONUIProvider`` takes ``handlers: Record<string, fn>``, but the
 *  agent invents action names per spec, so this answers every name with
 *  a handler that forwards it to ``dispatch``. ``has`` claims every key
 *  so the renderer never drops an action as unhandled. */
function forwardingHandlers(dispatch: DispatchAction | undefined): Record<string, ActionHandler> {
  return new Proxy<Record<string, ActionHandler>>(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        return async (params: Record<string, unknown>) => {
          if (dispatch) return dispatch(prop, params ?? {});
          // eslint-disable-next-line no-console
          console.debug("[json-render] unhandled action", prop, params);
          return undefined;
        };
      },
      has() {
        return true;
      },
    },
  );
}

/**
 * Why a spec cannot be drawn at all, or ``null``. Only a shape no stream
 * delta can complete counts: a root that is not an element key, or
 * elements that are not a map. A root still missing mid-stream is not one.
 * The Renderer draws nothing for these, so the card was empty, or absent,
 * while the agent said the chart was above (R666).
 */
export function unrenderableSpec(spec: unknown): string | null {
  if (spec == null || typeof spec !== "object") return null;
  const { root, elements } = spec as { root?: unknown; elements?: unknown };
  if (root !== undefined && typeof root !== "string") return "its root is not an element key";
  if (elements !== undefined && (elements === null || typeof elements !== "object" || Array.isArray(elements)))
    return "its elements are not a map of element keys";
  return null;
}

/** The failures of one draw, as the boundary catches them. */
class DrawCollector {
  private readonly failures: ElementDrawFailure[] = [];

  add(failure: ElementDrawFailure): void {
    const known = this.failures.some(
      (f) => f.type === failure.type && f.message === failure.message,
    );
    if (!known) this.failures.push(failure);
  }

  list(): ElementDrawFailure[] {
    return [...this.failures];
  }
}

/** One collector per draw. A new spec is a new draw, and the failures
 *  of the old one do not answer for it. */
function useCollector(spec: unknown): DrawCollector {
  const held = useRef<{ spec: unknown; collector: DrawCollector } | null>(null);
  if (!held.current || held.current.spec !== spec) {
    held.current = { spec, collector: new DrawCollector() };
  }
  return held.current.collector;
}

/** How many elements the card has. Zero when it cannot be drawn at
 *  all: there is then nothing on the screen to count. */
function elementCount(spec: unknown, unrenderable: string | null): number {
  if (unrenderable) return 0;
  const elements = (spec as { elements?: unknown } | null | undefined)?.elements;
  if (!elements || typeof elements !== "object" || Array.isArray(elements)) return 0;
  return Object.keys(elements).length;
}

function JsonRenderViewInner({
  spec,
  title,
  sourceAgent,
  notices,
  onDispatchAction,
  onDrawResult,
}: JsonRenderViewProps) {
  const handlers = useMemo(() => forwardingHandlers(onDispatchAction), [onDispatchAction]);
  // A model that wraps an array in {"item": [...]} means the list the
  // catalog asked for; the renderer reads it as one, so the card draws
  // instead of saying it could not (see jsonRender/specShape.ts).
  const drawable = useMemo(() => normaliseSpec(spec), [spec]);
  const unrenderable = unrenderableSpec(drawable);
  const issues = useMemo(
    () => [...(notices ?? []), ...(unrenderable ? [unrenderable] : [])],
    [notices, unrenderable],
  );
  const total = useMemo(() => elementCount(drawable, unrenderable), [drawable, unrenderable]);
  const collector = useCollector(drawable);
  // The report is said once the draw is on the screen: after the
  // commit, so the boundary has already caught what it could not draw.
  // A failure caught later is said again, but only by its own draw: a
  // failure of a new draw lands before the new draw's report is set
  // up, and the draw before it must not speak for it (R666).
  const say = useRef<{ collector: DrawCollector; report: () => void } | null>(null);
  const onFailure = useCallback(
    (failure: ElementDrawFailure) => {
      collector.add(failure);
      if (say.current?.collector === collector) say.current.report();
    },
    [collector],
  );
  useEffect(() => {
    const report = () => onDrawResult?.({ total, failed: collector.list(), issues });
    say.current = { collector, report };
    report();
    return () => {
      say.current = null;
    };
  }, [onDrawResult, total, issues, collector]);
  return (
    <div className="jr-view">
      {(title || sourceAgent) && (
        <div className="jr-view-header">
          {title && <div className="jr-view-title">{title}</div>}
          {sourceAgent && <div className="jr-view-source">via {sourceAgent}</div>}
        </div>
      )}
      {unrenderable ? (
        <div className="viz-render-error" role="note">
          This visualization could not be drawn: {unrenderable}.
        </div>
      ) : (
        <>
          <ElementFailureContext.Provider value={onFailure}>
            <JSONUIProvider registry={registry} handlers={handlers}>
              <Renderer spec={drawable} registry={registry} fallback={unknownComponent} />
            </JSONUIProvider>
          </ElementFailureContext.Provider>
          {notices && notices.length > 0 && (
            <div className="viz-render-error" role="note">
              {notices.map((notice) => (
                <div key={notice}>This visualization could not be fully drawn: {notice}.</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Memoized on its props: every stream delta brings a new spec object,
 *  so the reference is the change signal, and a chat re-render that
 *  leaves this card's props alone (a sibling item updating) skips it. */
export const JsonRenderView = memo(JsonRenderViewInner);
