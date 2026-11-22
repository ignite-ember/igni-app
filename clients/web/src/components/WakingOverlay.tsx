import { useEffect, useState } from "react";

import type { BackendSnapshot } from "../cloud/backendState";

/** How long the socket may be open without a `welcome` before the
 *  overlay shows: a running VM answers well inside it and never flashes
 *  the overlay (design §4.2). */
export const WAKING_DELAY_MS = 800;

/**
 * "Waking your cloud igni…": the previous content stays, dimmed, while
 * the gateway wakes the VM. The gateway sends nothing while it does, so
 * this is driven from here. Typing stays allowed: the gateway buffers
 * what is sent.
 */
export function WakingOverlay({ backend }: { backend: BackendSnapshot | null }) {
  const waiting = backend?.side === "cloud" && backend.connecting;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), WAKING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  if (!waiting || !shown) return null;
  return (
    <div className="waking-overlay" role="status" aria-live="polite">
      <div className="waking-overlay-card">
        <span className="waking-overlay-spinner" aria-hidden="true" />
        Waking your cloud igni…
      </div>
    </div>
  );
}
