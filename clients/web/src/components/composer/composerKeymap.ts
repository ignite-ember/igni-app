/**
 * What a key does in the composer's editor, as an ordered list of rules.
 *
 * The first rule whose guard matches and that consumes the key wins, so
 * the order is the behaviour: an open menu takes the arrows and Enter
 * before history and sending do; Escape comes before Backspace, Backspace
 * before history, history before Enter. A key no rule consumes is left to
 * the editor (a newline, a character deleted) or the app (Escape cancels
 * the run).
 *
 * Built per render from that render's state; it holds none of its own.
 * Its context is the render's `ComposerController`.
 */

import type { KeyboardEvent } from "react";

import type { CompletionMenu, MenuEntry } from "./completionMenu";
import { ComposerDraft } from "./composerDraft";
import type { HistoryStep, InputHistory } from "./InputHistory";

type KeyEvent = KeyboardEvent<HTMLDivElement>;

/** What the keymap reads and asks for; `ComposerController` is one. */
export interface KeymapContext {
  menu: CompletionMenu | null;
  moveMenu: (delta: number) => void;
  closeMenu: () => void;
  /** Accept a menu entry into the draft. */
  applyChoice: (entry: MenuEntry) => void;
  /** The draft this render shows. */
  draft: ComposerDraft;
  /** The draft as the model holds it now — newer than {@link draft}
   *  during a burst of keys that each wrote it. */
  currentDraft: () => ComposerDraft;
  history: InputHistory;
  /** Put a recalled entry in the composer. */
  recall: (step: HistoryStep) => void;
  submit: () => void;
  /** Leave command or shell mode with an empty draft. */
  exitToChat: () => void;
}

interface KeyRule {
  when: (e: KeyEvent) => boolean;
  /** Whether the key was consumed; one that was not goes on down the list. */
  run: (e: KeyEvent) => boolean;
}

export class ComposerKeymap {
  private readonly rules: readonly KeyRule[] = [
    { when: (e) => this.menuOpen && isArrow(e), run: (e) => this.menuNavigate(e) },
    { when: (e) => this.menuOpen && (e.key === "Tab" || e.key === "Enter"), run: (e) => this.menuAccept(e) },
    { when: (e) => e.key === "Escape", run: (e) => this.escape(e) },
    { when: (e) => e.key === "Backspace" && this.inMode, run: (e) => this.backspaceExitMode(e) },
    { when: (e) => e.key === "ArrowUp", run: (e) => this.historyPrev(e) },
    { when: (e) => e.key === "ArrowDown", run: (e) => this.historyNext(e) },
    { when: (e) => e.key === "Enter" && !e.shiftKey, run: (e) => this.submit(e) },
  ];

  constructor(private readonly ctx: KeymapContext) {}

  handle(e: KeyEvent): void {
    for (const rule of this.rules) {
      if (rule.when(e) && rule.run(e)) return;
    }
  }

  private get menuOpen(): boolean {
    return this.ctx.menu !== null;
  }

  private get inMode(): boolean {
    return this.ctx.draft.mode !== "chat";
  }

  private menuNavigate(e: KeyEvent): boolean {
    e.preventDefault();
    this.ctx.moveMenu(e.key === "ArrowDown" ? 1 : -1);
    return true;
  }

  /** Enter on a command already typed in full runs it, so `/help` needs
   *  one Enter, not one to complete and one to send. */
  private menuAccept(e: KeyEvent): boolean {
    const { menu, draft } = this.ctx;
    if (!menu) return false;
    e.preventDefault();
    const entry = menu.entries[menu.active];
    const typed = new ComposerDraft(draft.text.trim(), draft.mode).toWire();
    if (e.key === "Enter" && menu.kind === "slash" && entry.key === typed) {
      this.ctx.closeMenu();
      this.ctx.submit();
    } else {
      this.ctx.applyChoice(entry);
    }
    return true;
  }

  /** Abandon what is being typed: close the menu, leave command or shell
   *  mode. With neither to do, the key is the app's (cancel the run). */
  private escape(e: KeyEvent): boolean {
    let consumed = false;
    if (this.menuOpen) {
      this.ctx.closeMenu();
      consumed = true;
    }
    if (this.inMode) {
      this.ctx.exitToChat();
      consumed = true;
    }
    if (consumed) {
      e.preventDefault();
      e.stopPropagation();
    }
    return consumed;
  }

  /** On the last character, Backspace leaves the mode in the same press
   *  rather than leaving an empty prompt that needs a second one. */
  private backspaceExitMode(e: KeyEvent): boolean {
    if (this.ctx.currentDraft().text.length > 1) return false;
    e.preventDefault();
    this.ctx.exitToChat();
    return true;
  }

  /** Only from a single-line draft, where the caret is on the top line. */
  private historyPrev(e: KeyEvent): boolean {
    if (this.ctx.draft.text.includes("\n")) return false;
    const step = this.ctx.history.prev(this.ctx.draft.toWire());
    if (!step) return false;
    e.preventDefault();
    this.ctx.recall(step);
    return true;
  }

  private historyNext(e: KeyEvent): boolean {
    const step = this.ctx.history.next();
    if (!step) return false;
    e.preventDefault();
    this.ctx.recall(step);
    return true;
  }

  private submit(e: KeyEvent): boolean {
    e.preventDefault();
    this.ctx.submit();
    return true;
  }
}

function isArrow(e: KeyEvent): boolean {
  return e.key === "ArrowDown" || e.key === "ArrowUp";
}
