import { canStop, type RunPhase } from "../../chat/runPhase";
import type { ComposerMode } from "../../clientState";
import { ArrowUpIcon, ChevronIcon, StopIcon } from "../Icons";
import type { ModeUi } from "./modeUi";
import type { ComposerPopupApi } from "./useComposerPopup";

/** The row under the editor: the tools and attach buttons, the mode
 *  badge, the model chip, and Send — or Stop while the model is replying
 *  or the run waits on an approval. */
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
      {canStop(runPhase) ? (
        <button className="send-btn stop" title="Stop (Esc)" onClick={onStop}>
          <StopIcon />
        </button>
      ) : (
        <button
          type="button"
          className="send-btn"
          title="Send"
          disabled={!connected || !canSend}
          onClick={onSubmit}
        >
          <ArrowUpIcon />
        </button>
      )}
    </div>
  );
}
