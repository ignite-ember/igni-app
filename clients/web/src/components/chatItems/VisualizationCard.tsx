/**
 * A json-render card in the chat. One an extension appended is labelled
 * with the extension's name, looked up when it renders so a reload that
 * reads the history before the extensions are listed still gets it.
 */

import { Component, useCallback, type ReactNode } from "react";
import type { Spec } from "@json-render/core";

import type { VisualizationItem } from "../../chat/chatItem";
import { useExtensionName } from "../../extensions/extensionNames";
import { JsonRenderView, type CardDrawResult } from "../JsonRenderView";
import type { VisualizationHandlers } from "./handlers";

interface BoundaryProps {
  specSignature: string;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

/** Keeps a render failure inside one card, so a partial spec that
 *  produces NaN SVG attributes cannot take down the chat. A new
 *  signature clears the error and tries again. */
class VisualizationErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: BoundaryProps, prevState: BoundaryState) {
    if (
      prevState.error === this.state.error &&
      this.state.error &&
      prevProps.specSignature !== this.props.specSignature
    ) {
      queueMicrotask(() => this.setState({ error: null }));
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="viz-render-error">
          Visualization failed to render:{" "}
          <code>{String(this.state.error.message).slice(0, 240)}</code>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Cheap: the root and the element count change with every delta,
 *  which is all the boundary needs to retry. */
function specSignature(spec: Spec | null): string {
  return spec ? `${spec.root}|${Object.keys(spec.elements ?? {}).length}` : "null";
}

export function VisualizationCard({
  item,
  handlers,
}: {
  item: VisualizationItem;
  handlers?: VisualizationHandlers;
}) {
  const extensionName = useExtensionName(item.fromExtension);
  // TODO(pass 2): type the spec at the chat-item boundary instead.
  const spec = item.spec as Spec | null;
  const reportVerdict = handlers?.reportVerdict;
  const specId = item.specId;
  const revision = item.revision;
  const whole = item.final === true;
  /** What the card drew, said to the backend — so the agent is told
   *  what is on the screen rather than what it hoped for (R666). Only
   *  a whole card that names its draw is reported: a card still being
   *  drawn has not been drawn yet, and a card an extension appended
   *  is not the agent's card to be told about. */
  const onDrawResult = useCallback(
    (result: CardDrawResult) => {
      if (!whole || revision === undefined) return;
      reportVerdict?.({
        spec_id: specId,
        revision,
        total: result.total,
        failed: result.failed,
        issues: result.issues,
      });
    },
    [reportVerdict, revision, specId, whole],
  );
  return (
    <VisualizationErrorBoundary specSignature={specSignature(spec)}>
      <JsonRenderView
        spec={spec as Spec}
        title={item.title}
        sourceAgent={extensionName || item.sourceAgent}
        notices={item.notices}
        onDispatchAction={handlers?.dispatchAction}
        onDrawResult={onDrawResult}
      />
    </VisualizationErrorBoundary>
  );
}
