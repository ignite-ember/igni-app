/**
 * Editing a sent message in place. The draft shows each pasted snippet
 * as a placeholder, so editing the prose around a snippet never loses
 * the snippet; saving puts the snippets back.
 */

import { useRef, useState } from "react";

import type { UserItem } from "../../chat/chatItem";
import { CodePastePlaceholders } from "../../chat/codePaste";

export interface MessageEditor {
  editing: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  begin: () => void;
  cancel: () => void;
  /** Resends when the text changed and is not empty; ends editing
   *  either way. */
  submit: () => void;
}

export function useMessageEditor(
  item: UserItem,
  onEdit?: (item: UserItem, newText: string) => void,
): MessageEditor {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const placeholders = useRef(new CodePastePlaceholders());

  /** A fresh session: new placeholders, and the draft back to the
   *  message as sent. */
  const resetDraft = () => {
    placeholders.current = new CodePastePlaceholders();
    setDraft(placeholders.current.swap(item.text));
  };

  return {
    editing,
    draft,
    setDraft,
    begin: () => {
      resetDraft();
      setEditing(true);
    },
    cancel: () => {
      setEditing(false);
      resetDraft();
    },
    submit: () => {
      const restored = placeholders.current.restore(draft.trim());
      if (restored && restored !== item.text) onEdit?.(item, restored);
      setEditing(false);
    },
  };
}
