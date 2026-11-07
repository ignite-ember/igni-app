import { isProcessing, type RunPhase } from "../../chat/runPhase";
import type { ComposerMode } from "../../clientState";
import { ChevronIcon, StopIcon } from "../Icons";
import type { ModeUi } from "./modeUi";
import type { PermissionMode } from "./permissionModes";
import { SendButton } from "./SendButton";
import type { ComposerPopupApi } from "./useComposerPopup";

/** The row under the editor: the tools and attach buttons, the mode
 *  badge, the model chip, and Send — or Stop while the model is replying. */
export function ComposerBar({
  ui,
  draftMode,
  popups,
  onAttach,
  model,
  runPhase,
  connected,
  canSend,
  onSubmit,
  onStop,
  permissionMode,
  onPickMode,
}: {
  ui: ModeUi;
  draftMode: ComposerMode;
  popups: ComposerPopupApi;
  onAttach: () => void;
  model?: string;
  runPhase: RunPhase;
  connected: boolean;
  canSend: boolean;
  onSubmit: () => void;
  onStop: () => void;
  /** The backend's mode as the wire reports it; {@link SendButton} reads
   *  it with `permissionModeOption`, which also covers a mode it does not
   *  know. */
  permissionMode?: string;
  onPickMode?: (mode: PermissionMode) => void;
}) {
  const { popup } = popups;
  return (
    <div className="composer-bar">
      <button
        className={`slash-btn${popup.kind === "tools" || draftMode === "command" ? " open" : ""}`}
        title="Tools & commands"
        onClick={popups.toggleTools}
      >
        /
      </button>
      <button className="slash-btn attach-btn" title="Attach files" onClick={onAttach}>
        +
      </button>
      {ui.badge && <span className={ui.badge.className}>{ui.badge.label}</span>}
      <span className="composer-hint">Enter to send · Shift+Enter newline · ↑ history</span>
      <div className="header-spacer" />
      {model && (
        <button className="chip composer-model" title="Switch model" onClick={popups.toggleModel}>
          {model} <ChevronIcon size={9} down />
        </button>
      )}
      {isProcessing(runPhase) ? (
        <button className="send-btn stop" title="Stop (Esc)" onClick={onStop}>
          <StopIcon />
        </button>
      ) : (
        <SendButton
          connected={connected}
          canSend={canSend}
          onSubmit={onSubmit}
          permissionMode={permissionMode}
          onPickMode={onPickMode}
          menuOpen={popup.kind === "mode"}
          onToggleMenu={popups.toggleMode}
          onCloseMenu={popups.close}
        />
      )}
    </div>
  );
}
