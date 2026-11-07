import { useEffect, useMemo, useRef, useState } from "react";

import type { SlashCommand } from "../../chat/slashCommands";
import type { WindowModel } from "../../clientState";
import type { IgniClient } from "../../protocol/client";
import { EditableInput, type EditableInputHandle } from "../EditableInput";
import { ChevronIcon, StopIcon } from "../Icons";
import { CodePillRegistry } from "./CodePillRegistry";
import type { MenuEntry } from "./completionMenu";
import { ComposerDraft } from "./composerDraft";
import { ComposerKeymap } from "./composerKeymap";
import { InputHistory } from "./InputHistory";
import { DISCONNECTED_PLACEHOLDER, MODE_UI } from "./modeUi";
import { pasteHandler } from "./pasteHandler";
import type { PermissionMode } from "./permissionModes";
import { CompletionMenuView, ModelMenu, ToolsMenu, type ToolEntry } from "./popups";
import { SendButton } from "./SendButton";
import { useAttachments } from "./useAttachments";
import { useCompletionMenu } from "./useCompletionMenu";
import { useComposerDraft } from "./useComposerDraft";
import { useComposerPopup } from "./useComposerPopup";

export interface ComposerProps {
  client: IgniClient;
  connected: boolean;
  processing: boolean;
  skills: SlashCommand[];
  /** What the backend says exists, from `get_slash_commands`. `null`
   *  while it is still being fetched, or when the RPC is not there (an
   *  older backend) — the hardcoded list stands in. */
  backendCommands: SlashCommand[] | null;
  tools: ToolEntry[];
  /** Filled in with "hand the person the caret": the App calls it after
   *  putting text in the composer (a skill picked from a panel). */
  focusRef?: React.MutableRefObject<(() => void) | null>;
  /** The window's model; the draft and its mode are its `ui.composer`. */
  windowModel: WindowModel;
  /** Current model name, shown as a picker chip next to Send. */
  model?: string;
  /** External request to open the model menu (the /model command). */
  modelMenuSignal?: { n: number } | null;
  /** Rendered inside the composer box, above the editor: the HITL
   *  approval form rises out of the input panel instead of floating. */
  hitlSlot?: React.ReactNode;
  onPickModel: (name: string) => void;
  onTool: (command: string) => void;
  onTyping?: (text: string) => void;
  onSubmit: (text: string) => void;
  onStop: () => void;
  /** The backend's `PermissionEvaluator.mode`, as the wire reports it;
   *  pre-selects the send button's mode. */
  permissionMode?: string;
  /** A mode picked from the send button. The host fires the slash command
   *  that flips it; the picker is only a trigger. */
  onPickMode?: (mode: PermissionMode) => void;
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
  client,
  connected,
  processing,
  skills,
  backendCommands,
  tools,
  focusRef,
  windowModel,
  model,
  modelMenuSignal,
  hitlSlot,
  onPickModel,
  onTool,
  onTyping,
  onSubmit,
  onStop,
  permissionMode,
  onPickMode,
  brandName = "igni",
}: ComposerProps) {
  const ref = useRef<EditableInputHandle>(null);
  const composerDraft = useComposerDraft(windowModel);
  const { draft, setText } = composerDraft;
  const [history, setHistory] = useState(InputHistory.empty);
  const registry = useMemo(() => new CodePillRegistry(), []);
  const completion = useCompletionMenu({ client, backendCommands, skills });
  const closeMenu = completion.close;
  const popups = useComposerPopup({ client, modelMenuSignal, onOpen: closeMenu });
  const attachments = useAttachments({
    client,
    onLanded: (path) => {
      setText((prev) => {
        const sep = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
        return `${prev}${sep}@${path} `;
      });
      requestAnimationFrame(() => ref.current?.caretToEnd());
    },
  });

  const focusAtEnd = () =>
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.caretToEnd();
    });

  /** Back to an empty chat draft, menu closed, other views told. */
  const exitToChat = () => {
    composerDraft.write(ComposerDraft.EMPTY);
    ref.current?.setValue("");
    closeMenu();
    onTyping?.("");
  };

  const submit = () => {
    const raw = draft.text.trim();
    if (attachments.busy || !raw) return;
    // Uploads and typed mentions are already `@<path>` tokens in the
    // text; only the code pills need expanding.
    const { text, missing } = registry.expand(draft.withText(raw).toWire());
    if (missing.length) console.warn("Dropped code pills with no snippet:", missing);
    setHistory((h) => h.push(text));
    exitToChat();
    onSubmit(text);
  };

  const applyMenuChoice = (entry: MenuEntry) => {
    const menu = completion.menu;
    if (!menu) return;
    if (menu.kind === "slash") {
      setText(draft.mode === "command" ? `${entry.key.slice(1)} ` : `${entry.key} `);
    } else {
      const caret = ref.current?.caret() ?? draft.text.length;
      setText(`${draft.text.slice(0, menu.tokenStart)}@${entry.key} ${draft.text.slice(caret)}`);
    }
    closeMenu();
    focusAtEnd();
  };

  const keymap = new ComposerKeymap({
    menu: completion.menu,
    moveMenu: completion.move,
    closeMenu,
    applyChoice: applyMenuChoice,
    draft,
    currentDraft: composerDraft.current,
    history,
    recall: (step) => {
      setHistory(step.history);
      composerDraft.write(ComposerDraft.fromWire(step.entry));
    },
    submit,
    exitToChat,
  });

  const onValueChange = (value: string, caret: number) => {
    setHistory((h) => h.reset());
    const typed = draft.mode === "chat" ? ComposerDraft.fromTyped(value) : null;
    if (typed) {
      composerDraft.write(typed);
      // React often sees no text change here ("" → ""), so the editor's
      // value-prop sync would not run and the "/" or "$" would linger.
      ref.current?.setValue(typed.text);
      onTyping?.(typed.toWire());
      const probe = typed.triggerProbe(caret);
      void completion.refresh(probe.value, probe.caret);
      return;
    }
    const next = draft.withText(value);
    setText(value);
    onTyping?.(next.toWire());
    const probe = next.menuProbe(caret);
    void completion.refresh(probe.value, probe.caret);
  };

  const onPaste = pasteHandler({
    client,
    registry,
    composerDraft,
    editor: ref,
    addFiles: attachments.addFiles,
  });

  // External pre-fill (a skill picked from a panel): the App put the text
  // in the model; hand the person the caret to add arguments and send.
  useEffect(() => {
    if (!focusRef) return;
    focusRef.current = () => {
      closeMenu();
      setHistory((h) => h.reset());
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.caretToEnd();
      });
    };
    return () => {
      focusRef.current = null;
    };
  }, [focusRef, closeMenu]);

  const ui = MODE_UI[draft.mode];
  const { popup } = popups;

  return (
    <div {...attachments.dropZoneProps}>
      <div className="composer">
        {hitlSlot && <div className="composer-hitl">{hitlSlot}</div>}
        {popup.kind === "tools" && (
          <ToolsMenu
            tools={tools}
            onClose={popups.close}
            onPick={(command) => {
              popups.close();
              onTool(command);
            }}
          />
        )}
        {popup.kind === "model" && (
          <ModelMenu
            models={popup.models}
            onClose={popups.close}
            onPick={(name) => {
              popups.close();
              onPickModel(name);
            }}
          />
        )}
        {completion.menu && (
          <CompletionMenuView
            menu={completion.menu}
            onChoose={applyMenuChoice}
            onNearBottom={() => void completion.loadMore()}
          />
        )}
        {/* Uploads in flight show as chips until the backend returns a
            path, which then joins the draft as a pill. */}
        {attachments.uploads.length > 0 && (
          <div className="composer-attachments">
            {attachments.uploads.map((u) => (
              <span
                key={u.key}
                className="composer-chip-attach uploading"
                title={`${u.name} (uploading…)`}
              >
                <span className="composer-chip-name">{u.name}</span>
              </span>
            ))}
          </div>
        )}
        <input {...attachments.fileInputProps} />
        <EditableInput
          ref={ref}
          value={draft.text}
          disabled={!connected}
          className={ui.className}
          placeholder={connected ? ui.placeholder(brandName) : DISCONNECTED_PLACEHOLDER}
          codePillLabel={(id) => registry.label(id)}
          onValueChange={onValueChange}
          onKeyDown={(e) => keymap.handle(e)}
          onPaste={onPaste}
        />
        <div className="composer-bar">
          <button
            className={`slash-btn${popup.kind === "tools" || draft.mode === "command" ? " open" : ""}`}
            title="Tools & commands"
            onClick={popups.toggleTools}
          >
            /
          </button>
          <button className="slash-btn attach-btn" title="Attach files" onClick={attachments.pick}>
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
          {processing ? (
            <button className="send-btn stop" title="Stop (Esc)" onClick={onStop}>
              <StopIcon />
            </button>
          ) : (
            <SendButton
              connected={connected}
              canSend={!!draft.text.trim() || attachments.uploads.length > 0}
              onSubmit={submit}
              permissionMode={permissionMode}
              onPickMode={onPickMode}
              menuOpen={popup.kind === "mode"}
              onToggleMenu={popups.toggleMode}
              onCloseMenu={popups.close}
            />
          )}
        </div>
      </div>
    </div>
  );
}
