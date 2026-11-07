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
  permissionMode?: string;
  onPickMode?: (mode: PermissionMode) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
}) {
  const current = permissionModeOption(permissionMode);
  return (
    <div className="send-split" data-mode={current.value}>
      <button
        type="button"
        className="send-split-mode"
        title={`Mode: ${current.desc}`}
        onClick={onToggleMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="send-split-mode-label">{current.label}</span>
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
                className={`popup-item ${m.value === current.value ? "active" : ""}`}
                onClick={() => {
                  onCloseMenu();
                  if (m.value !== current.value) onPickMode?.(m.value);
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
