/**
 * The composer's hold on its editor: focus and the caret.
 *
 * The editor syncs its DOM to the `value` prop in an effect, so a caret
 * move right after a draft write has to wait for the next frame, or it
 * lands in the old text. Every such call goes through here, which makes
 * this the only composer code that schedules a frame.
 */

import type { RefObject } from "react";

import type { EditableInputHandle } from "../EditableInput";

export class ComposerEditor {
  constructor(private readonly ref: RefObject<EditableInputHandle | null>) {}

  /** Hand the person the caret, at the end of the draft. */
  focusAtEnd(): void {
    requestAnimationFrame(() => {
      this.ref.current?.focus();
      this.ref.current?.caretToEnd();
    });
  }

  /** The caret to the end once the draft just written has rendered. */
  caretToEndSoon(): void {
    requestAnimationFrame(() => this.ref.current?.caretToEnd());
  }

  /** The caret to `offset` once the draft just written has rendered. */
  caretAtSoon(offset: number): void {
    requestAnimationFrame(() => this.ref.current?.setCaretAt(offset));
  }

  /** Where the caret is, or `fallback` while the editor is not mounted. */
  caretOr(fallback: number): number {
    return this.ref.current?.caret() ?? fallback;
  }

  clear(): void {
    this.ref.current?.setValue("");
  }

  /**
   * Put `text` in the editor after a typed `/` or `$` was consumed into
   * the mode badge.
   *
   * The draft's text often does not change on that keystroke (`""` became
   * `""`), so React re-renders nothing and the editor's value-prop sync
   * never runs: the trigger character would stay on screen. This writes
   * the DOM directly instead (see `setValue` on `EditableInputHandle`).
   */
  resyncConsumedTrigger(text: string): void {
    this.ref.current?.setValue(text);
  }
}
