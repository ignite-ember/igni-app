/**
 * The composer's binding to the window model: the draft and its mode are
 * `ui.composer`. Every keystroke is written there (after a short pause on
 * the wire), so an extension sees the draft and can set it, and the draft
 * is the session's — it survives a reload and follows the session, not
 * the window. This is the one place the composer writes it.
 */

import { useMemo } from "react";

import { useWindowField, type WindowModel } from "../../clientState";
import { ComposerDraft } from "./composerDraft";

export interface ComposerDraftBinding {
  /** The draft this render shows. */
  draft: ComposerDraft;
  /** The draft as the model holds it right now, newer than {@link draft}
   *  inside an event handler that has already written. */
  current: () => ComposerDraft;
  write: (next: ComposerDraft) => void;
  /** Replace the text, keeping the mode the model has now. */
  setText: (next: string | ((prev: string) => string)) => void;
}

export function useComposerDraft(windowModel: WindowModel): ComposerDraftBinding {
  const composer = useWindowField(windowModel, "composer");
  const draft = useMemo(() => ComposerDraft.fromModel(composer), [composer]);
  const current = () => ComposerDraft.fromModel(windowModel.get("composer"));
  const write = (next: ComposerDraft) =>
    windowModel.write("composer", next.toModel(), { debounce: true });
  return {
    draft,
    current,
    write,
    setText: (next) => {
      const now = current();
      write(now.withText(typeof next === "function" ? next(now.text) : next));
    },
  };
}
