/**
 * The composer's draft: the text in the editor and the mode its prefix
 * put it in.
 *
 * Typing `/` or `$` into an empty chat draft consumes the character into
 * a mode badge, so the editor holds only the body. The wire form puts the
 * prefix back: `/help`, `$ ls`. History entries and pre-fills are wire
 * form, and enter the matching mode when read.
 */

import type { Composer, ComposerMode } from "../../clientState";
import type { CompletionMenu, MenuEntry } from "./completionMenu";

/** What the completion menu is asked to look at: a text and a caret in it. */
export interface MenuProbe {
  value: string;
  caret: number;
}

export class ComposerDraft {
  constructor(
    readonly text: string,
    readonly mode: ComposerMode,
  ) {}

  static readonly EMPTY = new ComposerDraft("", "chat");

  static fromModel(composer: Pick<Composer, "text" | "mode">): ComposerDraft {
    return new ComposerDraft(composer.text, composer.mode);
  }

  /** A wire-form entry (a history entry, a pre-fill), in its mode. */
  static fromWire(entry: string): ComposerDraft {
    if (entry.startsWith("/")) return new ComposerDraft(entry.slice(1), "command");
    if (entry.startsWith("$")) return new ComposerDraft(entry.slice(1).trimStart(), "shell");
    return new ComposerDraft(entry, "chat");
  }

  /** What a chat draft becomes when the person types a trigger character
   *  at its start; `null` when they did not. Only one space after the
   *  trigger is eaten, unlike {@link fromWire}. */
  static fromTyped(value: string): ComposerDraft | null {
    if (!value.startsWith("/") && !value.startsWith("$")) return null;
    const mode: ComposerMode = value.startsWith("/") ? "command" : "shell";
    return new ComposerDraft(value.slice(1).replace(/^ /, ""), mode);
  }

  withText(text: string): ComposerDraft {
    return new ComposerDraft(text, this.mode);
  }

  /** Something to send: more than whitespace. */
  get sendable(): boolean {
    return this.text.trim() !== "";
  }

  /** `@path ` added at the end, a space before it unless the text is
   *  empty or already ends in whitespace. How an uploaded file joins. */
  withMentionAppended(path: string): ComposerDraft {
    const { text } = this;
    const sep = text && !text.endsWith(" ") && !text.endsWith("\n") ? " " : "";
    return this.withText(`${text}${sep}@${path} `);
  }

  /** `snippet` inserted at `offset`. */
  withInsertedAt(offset: number, snippet: string): ComposerDraft {
    return this.withText(this.text.slice(0, offset) + snippet + this.text.slice(offset));
  }

  /** `entry` accepted from `menu` with the caret at `caret`: a command
   *  replaces the whole draft (without its `/` in command mode, where the
   *  badge stands for it); a file replaces the `@` token up to the caret. */
  withCompletion(menu: CompletionMenu, entry: MenuEntry, caret: number): ComposerDraft {
    if (menu.kind === "slash") {
      return this.withText(this.mode === "command" ? `${entry.key.slice(1)} ` : `${entry.key} `);
    }
    return this.withText(
      `${this.text.slice(0, menu.tokenStart)}@${entry.key} ${this.text.slice(caret)}`,
    );
  }

  /** The text with its mode's prefix: what is sent, and what history keeps. */
  toWire(): string {
    if (this.mode === "command") return `/${this.text}`;
    if (this.mode === "shell") return `$ ${this.text}`;
    return this.text;
  }

  /** As `ui.composer` holds it. */
  toModel(): Composer {
    return { text: this.text, mode: this.mode, attachments: [] };
  }

  /** What the menu looks at while the person types: the command prefix
   *  restored (the `/` menu matches on it, and the caret moves past it),
   *  but not the shell one. */
  menuProbe(caret: number): MenuProbe {
    return this.mode === "command"
      ? { value: `/${this.text}`, caret: caret + 1 }
      : { value: this.text, caret };
  }

  /** What the menu looks at on the keystroke that consumed a trigger: the
   *  wire form, with the caret at least past the prefix. */
  triggerProbe(caret: number): MenuProbe {
    return { value: this.toWire(), caret: Math.max(caret, 1) };
  }
}
