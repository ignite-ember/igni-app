/**
 * What the composer does: send, leave a mode, accept a menu entry, take a
 * keystroke, recall history, take a landed upload, take a pre-fill.
 *
 * Built per render from that render's state, the way {@link ComposerKeymap}
 * is; it holds none of its own. It is the keymap's context: the members the
 * keymap reads are named to match `KeymapContext`.
 */

import type { Dispatch, SetStateAction } from "react";

import type { CodePillRegistry } from "./CodePillRegistry";
import type { MenuEntry, CompletionMenu } from "./completionMenu";
import { ComposerDraft, type MenuProbe } from "./composerDraft";
import type { ComposerEditor } from "./ComposerEditor";
import { ComposerKeymap, type KeymapContext } from "./composerKeymap";
import type { HistoryStep, InputHistory } from "./InputHistory";
import type { AttachmentsApi } from "./useAttachments";
import type { CompletionMenuApi } from "./useCompletionMenu";
import type { ComposerDraftBinding } from "./useComposerDraft";

/** A message that left the composer. */
export interface SentMessage {
  /** Wire form, code pills expanded. */
  text: string;
  /** Code pills in the draft whose snippet the registry did not have;
   *  they were dropped from {@link text}. */
  droppedPills: string[];
}

export type SubmitOutcome =
  | ({ ok: true } & SentMessage)
  | { ok: false; reason: "empty" | "uploading" };

export interface ComposerControllerDeps {
  binding: ComposerDraftBinding;
  editor: ComposerEditor;
  history: InputHistory;
  setHistory: Dispatch<SetStateAction<InputHistory>>;
  registry: CodePillRegistry;
  completion: CompletionMenuApi;
  attachments: Pick<AttachmentsApi, "busy">;
  onTyping?: (wire: string) => void;
  onSent: (message: SentMessage) => void;
}

export class ComposerController implements KeymapContext {
  constructor(private readonly deps: ComposerControllerDeps) {}

  /** The draft this render shows. */
  get draft(): ComposerDraft {
    return this.deps.binding.draft;
  }

  get menu(): CompletionMenu | null {
    return this.deps.completion.menu;
  }

  get history(): InputHistory {
    return this.deps.history;
  }

  /** What both Send and Enter go by: text to send, and no upload still
   *  on its way in. Not `connected` or the run phase — Enter sends during
   *  a run, and the button adds `connected` itself. */
  get canSend(): boolean {
    return this.draft.sendable && !this.deps.attachments.busy;
  }

  /** The draft as the model holds it now, newer than {@link draft} inside
   *  a handler that has already written. */
  currentDraft(): ComposerDraft {
    return this.deps.binding.current();
  }

  moveMenu(delta: number): void {
    this.deps.completion.move(delta);
  }

  closeMenu(): void {
    this.deps.completion.close();
  }

  keymap(): ComposerKeymap {
    return new ComposerKeymap(this);
  }

  /** Send the draft: remembered in history, the composer emptied. */
  submit(): SubmitOutcome {
    if (this.deps.attachments.busy) return { ok: false, reason: "uploading" };
    if (!this.draft.sendable) return { ok: false, reason: "empty" };
    // Uploads and typed mentions are already `@<path>` tokens in the
    // text; only the code pills need expanding.
    const { text, missing } = this.deps.registry.expand(
      this.draft.withText(this.draft.text.trim()).toWire(),
    );
    this.deps.setHistory((h) => h.push(text));
    this.exitToChat();
    const sent: SentMessage = { text, droppedPills: missing };
    this.deps.onSent(sent);
    return { ok: true, ...sent };
  }

  /** Back to an empty chat draft, menu closed, other views told. */
  exitToChat(): void {
    this.deps.binding.write(ComposerDraft.EMPTY);
    this.deps.editor.clear();
    this.closeMenu();
    this.deps.onTyping?.("");
  }

  /** Accept a menu entry into the draft. */
  applyChoice(entry: MenuEntry): void {
    const { menu, draft } = this;
    if (!menu) return;
    const caret = this.deps.editor.caretOr(draft.text.length);
    this.deps.binding.setText(draft.withCompletion(menu, entry, caret).text);
    this.closeMenu();
    this.deps.editor.focusAtEnd();
  }

  /** The person typed: the editor now holds `value`, the caret at `caret`. */
  changeValue(value: string, caret: number): void {
    const { binding, editor, onTyping } = this.deps;
    this.deps.setHistory((h) => h.reset());
    const typed = this.draft.mode === "chat" ? ComposerDraft.fromTyped(value) : null;
    if (typed) {
      binding.write(typed);
      editor.resyncConsumedTrigger(typed.text);
      onTyping?.(typed.toWire());
      this.refreshMenu(typed.triggerProbe(caret));
      return;
    }
    const next = this.draft.withText(value);
    binding.setText(value);
    onTyping?.(next.toWire());
    this.refreshMenu(next.menuProbe(caret));
  }

  /** Put a recalled entry in the composer. */
  recall(step: HistoryStep): void {
    this.deps.setHistory(step.history);
    this.deps.binding.write(ComposerDraft.fromWire(step.entry));
  }

  /** An upload reached the project at `path`: it joins the draft as a
   *  mention. Reads the draft as it is now, since the upload outlived the
   *  render that started it. */
  landMention(path: string): void {
    const { binding, editor } = this.deps;
    binding.write(binding.current().withMentionAppended(path));
    editor.caretToEndSoon();
  }

  /** The host put text in the draft: hand the person the caret to add
   *  arguments and send. */
  prepareForPrefill(): void {
    this.closeMenu();
    this.deps.setHistory((h) => h.reset());
    this.deps.editor.focusAtEnd();
  }

  /** Not awaited: `refresh` never rejects (a failed lookup resolves to a
   *  closed menu), and a newer keystroke makes an older answer stale. */
  private refreshMenu(probe: MenuProbe): void {
    void this.deps.completion.refresh(probe.value, probe.caret);
  }
}
