/**
 * The recovery banner under an assistant bubble whose run did not
 * complete: Retry, Edit prompt and Discard, with keyboard shortcuts so
 * the person can recover without the mouse.
 */

import { useEffect, useRef, type KeyboardEvent } from "react";

import type { AssistantInterrupted } from "../../chat/chatItem";
import { ASSISTANT_INTERRUPTED_LABELS } from "../interruptedLabels";

/** A missing action disables its button and its shortcut. */
export interface InterruptedActions {
  retry?: () => void;
  discard?: () => void;
  editPrompt?: () => void;
}

/** Backspace is caught so it does not navigate the page back. */
const INTERRUPT_KEYMAP: ReadonlyMap<string, keyof InterruptedActions> = new Map([
  ["Enter", "retry"],
  ["Backspace", "discard"],
  ["Delete", "discard"],
  ["e", "editPrompt"],
]);

export function InterruptedBanner({
  reason,
  actions,
}: {
  reason: AssistantInterrupted;
  actions: InterruptedActions;
}) {
  // Focus on mount, so a keyboard user lands on the actions.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const label = ASSISTANT_INTERRUPTED_LABELS[reason];
  const onKeyDown = (e: KeyboardEvent) => {
    const name = INTERRUPT_KEYMAP.get(e.key);
    const action = name ? actions[name] : undefined;
    if (!action) return;
    e.preventDefault();
    action();
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="status"
      aria-live="polite"
      className={`msg-assistant-interrupted msg-assistant-interrupted--${reason}`}
      onKeyDown={onKeyDown}
    >
      <span className="msg-assistant-interrupted-label">{label}</span>
      <div className="msg-assistant-interrupted-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={actions.retry}
          disabled={!actions.retry}
          aria-label={`Retry: ${label.toLowerCase()}`}
        >
          Retry
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={actions.editPrompt}
          disabled={!actions.editPrompt}
          aria-label="Edit prompt for retry"
        >
          Edit prompt
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={actions.discard}
          disabled={!actions.discard}
          aria-label="Discard the partial response"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
