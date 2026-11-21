import type { BackendSnapshot } from "../cloud/backendState";
import { chipLabel, chipTitle, chipTone } from "../cloud/backendTexts";

/**
 * The backend chip in the status line: which side the app is on and, in
 * the cloud, its state — `Cloud`, `Cloud · waking…`, `Cloud · sign in`,
 * `Cloud · offline` (design §4.1). In `cloud` mode it shows with no
 * control; in `local` mode, or with no cloud igni, it is not drawn.
 */
export function BackendChip({ backend }: { backend: BackendSnapshot | null }) {
  if (!backend?.chipVisible) return null;
  return (
    <div className="group-pill-wrap backend-chip-wrap">
      <button className={`status-pill backend-chip tone-${chipTone(backend)}`} title={chipTitle(backend)} disabled>
        <span className="status-dot" />
        <span className="status-label">{chipLabel(backend)}</span>
      </button>
    </div>
  );
}
