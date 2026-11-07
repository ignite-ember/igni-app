/**
 * What a paste into the composer does: files are uploaded; a multi-line
 * snippet is inserted as text, looked up in the repository, and swapped
 * for a code pill when found there.
 */

import type { ClipboardEvent } from "react";

import { CodeMatchSet } from "../../chat/codeMatchSet";
import type { IgniClient } from "../../protocol/client";
import { CodePillRegistry } from "./CodePillRegistry";
import type { ComposerEditor } from "./ComposerEditor";
import type { AttachmentsApi } from "./useAttachments";
import type { ComposerDraftBinding } from "./useComposerDraft";

/** A paste at least this long, over more than one line, is looked up in
 *  the repository and becomes a code pill when found. */
const CODE_PASTE_MIN_CHARS = 30;

export interface PasteHandlerDeps {
  client: Pick<IgniClient, "searchCode">;
  registry: CodePillRegistry;
  binding: ComposerDraftBinding;
  editor: ComposerEditor;
  addFiles: AttachmentsApi["addFiles"];
}

export class PasteHandler {
  constructor(private readonly deps: PasteHandlerDeps) {}

  handle(e: ClipboardEvent<HTMLDivElement>): void {
    const { binding, editor } = this.deps;
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) {
      e.preventDefault();
      void this.deps.addFiles(files);
      return;
    }
    const pasted = e.clipboardData?.getData("text") || "";
    if (pasted.length < CODE_PASTE_MIN_CHARS || !pasted.includes("\n")) return;
    // Insert it ourselves: contenteditable splits multi-line text across
    // <div>/<br> nodes, and the swap must find exactly what was searched.
    e.preventDefault();
    const caret = editor.caretOr(binding.draft.text.length);
    binding.write(binding.current().withInsertedAt(caret, pasted));
    editor.caretAtSoon(caret + pasted.length);
    void this.pillCodePaste(pasted);
  }

  /** Swap a pasted snippet for a pill when the repository has it. */
  private async pillCodePaste(snippet: string): Promise<void> {
    const { client, registry, binding, editor } = this.deps;
    const result = await client.searchCode(snippet);
    if (!result.ok) {
      console.warn("search_code failed", result.reason);
      return;
    }
    const matches = CodeMatchSet.of(result.matches);
    if (!matches) return;
    // Registered before the token goes in, so the pill renders labelled.
    const id = registry.register(snippet, matches);
    const swapped = CodePillRegistry.swapSnippet(binding.current().text, snippet, id);
    if (!swapped) return;
    binding.setText(swapped.text);
    // The browser left the caret where the longer snippet ended.
    editor.caretAtSoon(swapped.caret);
  }
}
