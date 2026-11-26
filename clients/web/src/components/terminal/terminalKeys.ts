/**
 * While the terminal has focus it owns the keyboard: Escape belongs to
 * vim, ⌘F to less, ⌘P to whatever the shell runs. The pane stops a key
 * from bubbling past it, and the window's capture-phase listeners — the
 * ones that would see it first — ask {@link isTerminalKey} and step
 * aside.
 */

/** The attribute the terminal pane carries. */
export const TERMINAL_ATTR = "data-terminal";

/** Whether a key event happened inside the terminal. */
export function isTerminalKey(e: Event): boolean {
  const target = e.target;
  return target instanceof Element && target.closest(`[${TERMINAL_ATTR}]`) !== null;
}
