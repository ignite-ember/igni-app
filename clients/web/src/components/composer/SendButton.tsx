import type { PermissionModeName } from "../../protocol/messages";
import { ArrowUpIcon, ChevronIcon } from "../Icons";
import { PopupBackdrop } from "./popups";
import { PERMISSION_MODES, permissionModeOption, type PermissionMode } from "./permissionModes";

/** Split send button — the left half opens the four permission modes, the
 *  right half sends. The person can change the agent's permission surface
 *  at the moment of sending instead of digging into `/plan` / `/accept` /
 *  `/bypass`. The left half is narrower (~3:5) so Send stays the visually
 *  dominant target. */
export function SendButton({
  connected,
  canSend,
  onSubmit,
  permissionMode,
  onPickMode,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
}: {
  connected: boolean;
  canSend: boolean;
  onSubmit: () => void;
  /** The backend's current mode, as the wire reports it. */
  permissionMode?: PermissionModeName;
  onPickMode?: (mode: PermissionMode) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
}) {
  const reported = permissionModeOption(permissionMode);
  // A mode this client does not know is shown as unknown, not read as
  // the default — the session may well be running in something else.
  const current = reported?.value ?? "unknown";
  const label = reported?.label ?? "Mode";
  const desc = reported?.desc ?? "The backend reports a permission mode this client does not know.";
  return (
    <div className="send-split" data-mode={current}>
      <button
        type="button"
        className="send-split-mode"
        title={`Mode: ${desc}`}
        onClick={onToggleMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="send-split-mode-label">{label}</span>
        <ChevronIcon size={9} down={!menuOpen} />
      </button>
      <button
        type="button"
        className="send-split-go"
        title="Send"
        disabled={!connected || !canSend}
        onClick={onSubmit}
      >
        <ArrowUpIcon />
      </button>
      {menuOpen && (
        <>
          <PopupBackdrop onClose={onCloseMenu} />
          <div className="popup-menu send-mode-menu" role="menu">
            {PERMISSION_MODES.map((m) => (
              <div
                key={m.value}
                role="menuitem"
                className={`popup-item ${m.value === current ? "active" : ""}`}
                onClick={() => {
                  onCloseMenu();
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
