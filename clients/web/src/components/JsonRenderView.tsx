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
 */

import { Renderer, JSONUIProvider } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { memo, useMemo } from "react";
import { registry, unknownComponent } from "./jsonRender/registry";
import "./JsonRenderView.css";

export type DispatchAction = (name: string, params: Record<string, unknown>) => Promise<unknown>;

type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

interface JsonRenderViewProps {
  spec: Spec;
  title?: string;
  sourceAgent?: string;
  onDispatchAction?: DispatchAction;
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

function JsonRenderViewInner({ spec, title, sourceAgent, onDispatchAction }: JsonRenderViewProps) {
  const handlers = useMemo(() => forwardingHandlers(onDispatchAction), [onDispatchAction]);
  const unrenderable = unrenderableSpec(spec);
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
        <JSONUIProvider registry={registry} handlers={handlers}>
          <Renderer spec={spec} registry={registry} fallback={unknownComponent} />
        </JSONUIProvider>
      )}
    </div>
  );
}

/** Memoized on its props: every stream delta brings a new spec object,
 *  so the reference is the change signal, and a chat re-render that
 *  leaves this card's props alone (a sibling item updating) skips it. */
export const JsonRenderView = memo(JsonRenderViewInner);
