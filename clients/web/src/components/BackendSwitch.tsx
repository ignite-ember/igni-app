import { useState } from "react";

import type { BackendSnapshot, Side } from "../cloud/backendState";
import { badgeText } from "../cloud/backendTexts";
import { host } from "../lib/host";

/**
 * *This computer · Cloud*: the app-wide side, at the top of the account
 * menu (design §4.1). Shown only for a person with a cloud igni in a
 * group that offers both sides; the shell decides that
 * (`switch_visible`). Flipping re-points every window, so this window
 * reloads onto the other side and the control goes with it.
 *
 * On the cloud, what is still going on this computer — a run, an
 * approval waiting — shows as a badge that switches back.
 */
export function BackendSwitch({
  backend,
  switchTo = (side) => host.switchBackend(side),
}: {
  backend: BackendSnapshot;
  /** The shell's `switch_backend`; a test passes its own. */
  switchTo?: (side: Side) => Promise<void>;
}) {
  const [busy, setBusy] = useState<Side | null>(null);
  const [error, setError] = useState("");
  if (!backend.switchVisible) return null;

  const flip = (side: Side) => {
    if (side === backend.side || busy) return;
    setBusy(side);
    setError("");
    switchTo(side)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };
  const badge = badgeText(backend);

  return (
    <div className="popup-item backend-switch">
      <div className="backend-switch-control" role="radiogroup" aria-label="Where igni runs">
        {(["local", "cloud"] as const).map((side) => (
          <button
            key={side}
            type="button"
            role="radio"
            aria-checked={backend.side === side}
            className={`backend-switch-option${backend.side === side ? " active" : ""}`}
            disabled={busy !== null}
            onClick={(e) => {
              e.stopPropagation();
              flip(side);
            }}
          >
            {side === "local" ? "This computer" : "Cloud"}
            {busy === side ? "…" : ""}
          </button>
        ))}
      </div>
      {badge && backend.side === "cloud" && (
        <button
          type="button"
          className="backend-switch-badge"
          title="Switch back to this computer"
          onClick={(e) => {
            e.stopPropagation();
            flip("local");
          }}
        >
          {badge}
        </button>
      )}
      {error && (
        <span className="backend-switch-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
