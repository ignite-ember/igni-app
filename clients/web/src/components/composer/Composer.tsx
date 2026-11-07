import { useRef, type ReactNode, type Ref } from "react";

import type { RunPhase } from "../../chat/runPhase";
import type { WindowModel } from "../../clientState";
import type { IgniClient } from "../../protocol/client";
import { EditableInput, type EditableInputHandle } from "../EditableInput";
import { ComposerBar } from "./ComposerBar";
import type { ComposerActions, ComposerCatalog, ComposerHandle } from "./composerContract";
import { DISCONNECTED_PLACEHOLDER, MODE_UI } from "./modeUi";
import { ComposerPopupLayer } from "./popups";
import { UploadChips } from "./UploadChips";
import { useComposerController } from "./useComposerController";
import { useComposerPopup, type ModelMenuRequest } from "./useComposerPopup";

export interface ComposerProps {
  /** Filled in with the composer's handle while it is mounted. */
  ref?: Ref<ComposerHandle>;
  client: IgniClient;
  connected: boolean;
  /** The current turn's phase: Stop replaces Send while it is processing. */
  runPhase: RunPhase;
  catalog: ComposerCatalog;
  actions: ComposerActions;
  /** The window's model; the draft and its mode are its `ui.composer`. */
  windowModel: WindowModel;
  /** Current model name, shown as a picker chip next to Send. */
  model?: string;
  /** External request to open the model menu (the /model command). */
  modelMenuSignal?: ModelMenuRequest | null;
  /** Rendered inside the composer box, above the editor: the HITL
   *  approval form rises out of the input panel instead of floating. */
  hitlSlot?: ReactNode;
  /** The backend's `PermissionEvaluator.mode`, as the wire reports it;
   *  pre-selects the send button's mode. Kept a wire string: the button
   *  parses it, falling back for a mode this client does not know. */
  permissionMode?: string;
  /** The product's name in the placeholder — a group can rebrand it.
   *  See `lib/theme.ts`. */
  brandName?: string;
}

/**
 * Claude-style composer: `/` command menu, `@` file mentions (BE-side
 * FileIndex), `$` shell mode badge, pasted code as pills, Up/Down input
 * history, send/stop button.
 */
export function Composer({
  ref,
  client,
  connected,
  runPhase,
  catalog,
  actions,
  windowModel,
  model,
  modelMenuSignal,
  hitlSlot,
  permissionMode,
  brandName = "igni",
}: ComposerProps) {
  const editorRef = useRef<EditableInputHandle>(null);
  const { controller, completion, attachments, paste, registry } = useComposerController({
    client,
    windowModel,
    catalog,
    onTyping: actions.onTyping,
    onSubmit: actions.onSubmit,
    editorRef,
    ref,
  });
  const popups = useComposerPopup({ client, modelMenuSignal, onOpen: completion.close });
  const keymap = controller.keymap();
  const { draft } = controller;
  const ui = MODE_UI[draft.mode];

  return (
    <div {...attachments.dropZoneProps}>
      <div className="composer">
        {hitlSlot && <div className="composer-hitl">{hitlSlot}</div>}
        <ComposerPopupLayer
          popups={popups}
          tools={catalog.tools}
          onTool={actions.onTool}
          onPickModel={actions.onPickModel}
          completion={completion}
          onChoose={(entry) => controller.applyChoice(entry)}
        />
        <UploadChips uploads={attachments.uploads} />
        <input {...attachments.fileInputProps} />
        <EditableInput
          ref={editorRef}
          value={draft.text}
          disabled={!connected}
          className={ui.className}
          placeholder={connected ? ui.placeholder(brandName) : DISCONNECTED_PLACEHOLDER}
          codePillLabel={(id) => registry.label(id)}
          onValueChange={(value, caret) => controller.changeValue(value, caret)}
          onKeyDown={(e) => keymap.handle(e)}
          onPaste={(e) => paste.handle(e)}
        />
        <ComposerBar
          ui={ui}
          draftMode={draft.mode}
          popups={popups}
          onAttach={attachments.pick}
          model={model}
          runPhase={runPhase}
          connected={connected}
          canSend={controller.canSend}
          onSubmit={() => controller.submit()}
          onStop={actions.onStop}
          permissionMode={permissionMode}
          onPickMode={actions.onPickMode}
        />
      </div>
    </div>
  );
}
