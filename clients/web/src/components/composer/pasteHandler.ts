/**
 * What a paste into the composer does: files are uploaded; a multi-line
 * snippet is inserted as text, looked up in the repository, and swapped
 * for a code pill when found there.
 */

import { CodeMatchSet } from "../../chat/codeMatchSet";
import type { IgniClient } from "../../protocol/client";
import type { EditableInputHandle } from "../EditableInput";
import { CodePillRegistry } from "./CodePillRegistry";
import type { ComposerDraftBinding } from "./useComposerDraft";

/** A paste at least this long, over more than one line, is looked up in
 *  the repository and becomes a code pill when found. */
const CODE_PASTE_MIN_CHARS = 30;

export interface PasteContext {
  client: Pick<IgniClient, "searchCode">;
  registry: CodePillRegistry;
  composerDraft: ComposerDraftBinding;
  editor: React.RefObject<EditableInputHandle | null>;
  addFiles: (files: File[]) => Promise<void>;
}

export function pasteHandler({
  client,
  registry,
  composerDraft,
  editor,
  addFiles,
}: PasteContext): (e: React.ClipboardEvent<HTMLDivElement>) => void {
  const { setText } = composerDraft;

  /** Swap a pasted snippet for a pill when the repository has it. */
  const pillCodePaste = async (snippet: string) => {
    const result = await client.searchCode(snippet);
    if (!result.ok) {
      console.warn("search_code failed", result.reason);
      return;
    }
    const matches = CodeMatchSet.of(result.matches);
    if (!matches) return;
    // Registered before the token goes in, so the pill renders labelled.
    const id = registry.register(snippet, matches);
    const swapped = CodePillRegistry.swapSnippet(composerDraft.current().text, snippet, id);
    if (!swapped) return;
    setText(swapped.text);
    // The browser left the caret where the longer snippet ended.
    requestAnimationFrame(() => editor.current?.setCaretAt(swapped.caret));
  };

  return (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
      return;
    }
    const pasted = e.clipboardData?.getData("text") || "";
    if (pasted.length < CODE_PASTE_MIN_CHARS || !pasted.includes("\n")) return;
    // Insert it ourselves: contenteditable splits multi-line text across
    // <div>/<br> nodes, and the swap must find exactly what was searched.
    e.preventDefault();
    const caret = editor.current?.caret() ?? composerDraft.draft.text.length;
    setText((cur) => cur.slice(0, caret) + pasted + cur.slice(caret));
    requestAnimationFrame(() => editor.current?.setCaretAt(caret + pasted.length));
    void pillCodePaste(pasted);
  };
}
