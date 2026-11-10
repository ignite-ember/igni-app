import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { PillEditor } from "./pillEditor/PillEditor";
import { type CodePillLabeler, noLabels } from "./pillEditor/pills";

/** Contenteditable replacement for the composer textarea. Renders
 *  `@<path>` tokens as inline pills the moment they're followed by
 *  whitespace; backspacing right after a pill deletes it as one unit.
 *  The canonical value is still a plain string with literal `@<path>`
 *  tokens.
 */
export interface EditableInputHandle {
  focus: () => void;
  /** Caret offset in canonical-string space. */
  caret: () => number;
  /** Move caret to the end of the current content. */
  caretToEnd: () => void;
  /** Move caret to a specific canonical offset. The editor's DOM
   *  sync runs in a useEffect so call this *after* the next render
   *  via requestAnimationFrame if you've just updated the value. */
  setCaretAt: (offset: number) => void;
  /** Force the live DOM to match ``v``, bypassing the value-prop
   *  reconcile path. The Composer uses this when it consumes a typed
   *  trigger character (e.g. ``/`` flips to command mode + clears
   *  text) — React sees no state change in those cases, so the
   *  ``useEffect`` watcher wouldn't fire. */
  setValue: (v: string) => void;
}

interface Props {
  value: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onValueChange: (next: string, caret: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  /** Labels for `@code:<id>` pills, from whoever inserted them (the
   *  Composer's pill registry). Without one, or for an id it does not
   *  know, a pill reads "code". */
  codePillLabel?: CodePillLabeler;
}

export const EditableInput = forwardRef<EditableInputHandle, Props>(function EditableInput(
  { value, disabled, placeholder, className, onValueChange, onKeyDown, onPaste, codePillLabel },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null);
  // One model per mounted root. The effects and the imperative handle are
  // created once, so they reach it (and its labeler) through this ref.
  const editorRef = useRef<PillEditor | null>(null);
  const editor = useCallback((): PillEditor | null => {
    const el = elRef.current;
    if (!el) return null;
    if (!editorRef.current) editorRef.current = new PillEditor(el);
    return editorRef.current;
  }, []);
  useEffect(() => {
    editor()?.setLabels(codePillLabel ?? noLabels);
  }, [editor, codePillLabel]);
  // Tracks the most recent value our own ``handleInput`` reported up
  // to the parent. When the next ``value`` prop comes back equal, we
  // know the DOM is already authoritative and skip the reconcile —
  // no DOM walk, no string compare, no risk of clobbering an
  // in-flight keystroke.
  const lastTypedRef = useRef<string | null>(null);

  // Sync external value → DOM only when `value` actually changes.
  // Running on every render instead would rewrite the DOM and reset the
  // caret on each parent re-render, racing rapid typing ("test" landing
  // as "tets"). A typed trigger the parent consumes without changing
  // `value` (``/`` flipping modes) is handled imperatively via
  // ``setValue`` on the ref.
  useEffect(() => {
    // Value originated from our own input handler — the DOM is
    // already correct; don't even walk it.
    if (lastTypedRef.current === value) {
      lastTypedRef.current = null;
      return;
    }
    editor()?.show(value);
  }, [editor, value]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => elRef.current?.focus(),
      caret: () => editor()?.caret() ?? 0,
      caretToEnd: () => editor()?.caretToEnd(),
      setCaretAt: (offset: number) => editor()?.placeCaret(offset),
      setValue: (v: string) => editor()?.show(v),
    }),
    [editor],
  );

  const handleInput = useCallback(() => {
    const ed = editor();
    if (!ed) return;
    const next = ed.readTyped();
    lastTypedRef.current = next;
    onValueChange(next, ed.caret());
  }, [editor, onValueChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Treat a pill as a single character: Backspace right after one
      // deletes the whole pill rather than expanding it back into
      // `@path` text, as users expect of chips.
      const ed = editor();
      if (e.key === "Backspace" && ed?.deletePillBeforeCaret()) {
        e.preventDefault();
        // Run the onValueChange pipeline so the canonical string
        // reflects the deletion, then merge the text the pill split.
        handleInput();
        ed.mergeText();
        return;
      }
      onKeyDown?.(e);
    },
    [editor, handleInput, onKeyDown],
  );

  return (
    <div
      ref={elRef}
      className={`composer-editable${className ? " " + className : ""}`}
      contentEditable={!disabled}
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      spellCheck
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={onPaste}
    />
  );
});
