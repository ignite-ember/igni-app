/**
 * The run lifecycle — one {@link RunPhase} every busy flag derives from
 * — and the counters that go with it.
 *
 * ``setRunPhase`` is the only writer, and keeps a synchronous mirror
 * for handlers that cannot wait for the next render (the Escape key,
 * submit, the socket listener). Cancel is one transition: anything that
 * cares about a cancelled run watches the phase (see App's effect that
 * stamps the interrupted banner), rather than every Stop control
 * repeating the clean-up. See ``chat/runPhase.ts`` for the transitions.
 */

import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";

import type { IgniClient } from "../protocol/client";
import { isProcessing, type RunPhase } from "./runPhase";

/** The parts of the run lifecycle that never change identity: what a
 *  controller built once per window holds, so it can never read a stale
 *  phase through a closure. */
export interface RunControls {
  /** ``runPhase`` as of the last write, readable before React renders. */
  readonly runPhaseRef: { readonly current: RunPhase };
  readonly setRunPhase: (phase: RunPhase) => void;
  /** Stop the run: phase ``cancelled``, then tell the backend. */
  readonly cancel: () => void;
  /** Bumped when the view starts over (``/clear``, ``/fork``): late
   *  events from a run started before it are dropped. */
  readonly viewGenRef: { readonly current: number };
  readonly bumpViewGen: () => void;
  /** Set by the HITL dialog's "accept edits for this run": the end of
   *  the run's stream turns acceptEdits back off. */
  readonly autoAcceptForRunRef: MutableRefObject<boolean>;
  /** The HITL dialog's "accept edits for this run". ``streaming_done``
   *  turns it back off, so the gate does not quietly outlive this task;
   *  the flip itself rides on the HITL decision
   *  (``HITLDecision.set_permission_mode``). */
  readonly acceptEditsForThisRun: () => void;
}

export interface RunPhaseState {
  runPhase: RunPhase;
  /** The same lifecycle, as one object whose identity never changes. */
  controls: RunControls;
  /** ``runPhase`` as of the last write, readable before React renders. */
  runPhaseRef: { readonly current: RunPhase };
  setRunPhase: (phase: RunPhase) => void;
  /** Stop the run: phase ``cancelled``, then tell the backend. */
  cancel: () => void;
  /** Bumped when the view starts over (``/clear``, ``/fork``): late
   *  events from a run started before it are dropped. */
  viewGenRef: MutableRefObject<number>;
  bumpViewGen: () => void;
  /** Set by the HITL dialog's "accept edits for this run": the end of
   *  the run's stream turns acceptEdits back off. */
  autoAcceptForRunRef: MutableRefObject<boolean>;
  processing: boolean;
}

export function useRunPhase(client: IgniClient): RunPhaseState {
  const [runPhase, setRunPhaseState] = useState<RunPhase>("idle");
  const runPhaseRef = useRef<RunPhase>("idle");
  const viewGenRef = useRef(0);
  const autoAcceptForRunRef = useRef(false);
  const setRunPhase = useCallback((phase: RunPhase) => {
    runPhaseRef.current = phase;
    setRunPhaseState(phase);
  }, []);
  const cancel = useCallback(() => {
    setRunPhase("cancelled");
    client.cancel();
  }, [client, setRunPhase]);
  const bumpViewGen = useCallback(() => {
    viewGenRef.current++;
  }, []);
  const processing = isProcessing(runPhase);
  const controls = useMemo<RunControls>(
    () => ({
      runPhaseRef,
      setRunPhase,
      cancel,
      viewGenRef,
      bumpViewGen,
      autoAcceptForRunRef,
      acceptEditsForThisRun: () => {
        autoAcceptForRunRef.current = true;
      },
    }),
    [setRunPhase, cancel, bumpViewGen],
  );
  return useMemo(
    () => ({
      runPhase,
      controls,
      runPhaseRef,
      setRunPhase,
      cancel,
      viewGenRef,
      bumpViewGen,
      autoAcceptForRunRef,
      processing,
    }),
    [runPhase, controls, setRunPhase, cancel, bumpViewGen, processing],
  );
}
