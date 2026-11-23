import { useCallback, useEffect, useRef, useState } from "react";

import type { PermissionModeName } from "../../protocol/messages";
import { ChevronIcon } from "../Icons";
import { PERMISSION_MODES, permissionModeOption, type PermissionMode } from "./permissionModes";

/** The permission mode, as a text chip in the composer footer that opens
 *  the mode picker — the way Claude keeps its mode under the input, rather
 *  than on the send button. Self-contained: it owns its own menu. */
export function ModeChip({
  permissionMode,
  onPickMode,
}: {
  /** The backend's current mode, as the wire reports it. */
  permissionMode?: PermissionModeName;
  onPickMode?: (mode: PermissionMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const reported = permissionModeOption(permissionMode);
  // A mode this client does not know is shown as unknown, not read as the
  // default — the session may well be running in something else.
  const current = reported?.value ?? "unknown";
  const label = reported?.label ?? "Mode";
  const desc = reported?.desc ?? "The backend reports a permission mode this client does not know.";

  return (
    <div className="composer-mode-wrap">
      <button
        ref={btnRef}
        type="button"
        className="chip composer-mode"
        title={`Permission mode — ${desc}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label} <ChevronIcon size={9} up={!open} down={open} />
      </button>
      {open && (
        <>
          <span className="ctx-backdrop" onClick={close} />
          <div className="popup-menu send-mode-menu" role="menu">
            {PERMISSION_MODES.map((m) => (
              <div
                key={m.value}
                role="menuitem"
                className={`popup-item ${m.value === current ? "active" : ""}`}
                onClick={() => {
                  close();
                  if (m.value !== current) onPickMode?.(m.value);
                }}
              >
                <span className="cmd">{m.label}</span>
                <span className="desc">{m.desc}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
