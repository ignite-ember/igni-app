/**
 * The HITL dialog's state, and the Escape key that answers it.
 *
 * Esc is one global handler (see ``escHandler.ts``): with the dialog
 * open it rejects every pending requirement and cancels; during a run
 * it cancels; idle, it lets the OS have it. In macOS fullscreen WebKit
 * hands Esc to JS before the OS exits fullscreen, and
 * ``preventDefault`` keeps it in-app.
 *
 * The composer's Stop is the same act as Escape: ``stop`` is what both
 * call, so while an approval waits, Stop rejects every pending
 * requirement in one batch and cancels — no extra model turn.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { IgniClient } from "../protocol/client";
import { handleEsc } from "./escHandler";
import { HitlRequests, type OpenApprovals } from "./hitlRequests";
import { shouldShowSpinner } from "./runPhase";
import type { RunControls } from "./useRunPhase";

export interface HitlState {
  pending: OpenApprovals;
  requests: HitlRequests;
  /** Stop the run: with approvals open, reject them all in one batch
   *  and cancel; otherwise cancel. Escape and the composer's Stop. */
  stop: () => void;
}

export function useHitl(
  client: Pick<IgniClient, "resolveHitlBatch">,
  run: Pick<RunControls, "runPhaseRef" | "cancel">,
): HitlState {
  const [pending, setPending] = useState<OpenApprovals>(null);
  const requests = useMemo(() => new HitlRequests(setPending), []);

  const stop = useCallback(() => {
    if (pending) {
      // One batch of rejections: the backend resumes, sees them and
      // aborts. The resumed stream carries nothing this view needs.
      const rejected = pending.map((req) => ({
        requirement_id: req.requirement_id,
        action: "reject" as const,
        choice: "" as const,
      }));
      requests.clear();
      void client.resolveHitlBatch(rejected, () => {});
    }
    run.cancel();
  }, [client, pending, requests, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = handleEsc(e, {
        hitl: pending,
        isProcessing: shouldShowSpinner(run.runPhaseRef.current),
        isFullscreen: document.documentElement.dataset.fullscreen === "true",
      });
      if (action.preventDefault) e.preventDefault();
      const kind = action.decision?.kind;
      if (kind === "reject_hitl_and_cancel" || kind === "cancel_generation") stop();
      // ``block_fullscreen_exit`` is swallowed: the green button or a
      // held Esc still exits.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, run, stop]);

  return useMemo(() => ({ pending, requests, stop }), [pending, requests, stop]);
}
