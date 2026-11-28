/** What a notification's button does, and what it says: always the
 *  thing it opens, by name ("Open chat ‘CV review’"), never a bare verb.
 *  Built only by {@link NotificationActions}, which builds one only
 *  when the thing is there to open. */

/** How long a name may run on the button before it is cut. */
export const NAME_CHARS = 28;

const ELLIPSIS = "…";

/** What the button reaches: a decision waiting on you, a chat, a page,
 *  or the update waiting to install. */
export type ActionKind = "decision" | "chat" | "page" | "update";

export class NotificationAction {
  private constructor(
    readonly kind: ActionKind,
    /** The whole label, every name in full: the tooltip and the
     *  accessible name. */
    readonly label: string,
    /** The label as the button draws it, a long name cut short. */
    readonly text: string,
    private readonly go: () => void,
  ) {}

  /** An action whose label is `before`, `name` in quotes, then `after`. */
  static named(kind: ActionKind, before: string, name: string, after: string, go: () => void): NotificationAction {
    const label = `${before}‘${name}’${after}`;
    const text = `${before}‘${NotificationAction.cut(name)}’${after}`;
    return new NotificationAction(kind, label, text, go);
  }

  /** An action whose label names its object without quotes. */
  static plain(kind: ActionKind, label: string, go: () => void): NotificationAction {
    return new NotificationAction(kind, label, label, go);
  }

  /** `name` cut to {@link NAME_CHARS}, at a word when one ends in its
   *  second half, an ellipsis marking the cut. */
  static cut(name: string): string {
    if (name.length <= NAME_CHARS) return name;
    const head = name.slice(0, NAME_CHARS - 1);
    const space = head.lastIndexOf(" ");
    return (space > NAME_CHARS / 2 ? head.slice(0, space) : head).trimEnd() + ELLIPSIS;
  }

  /** It reaches a decision that is still waiting on the person. */
  get decides(): boolean {
    return this.kind === "decision";
  }

  run(): void {
    this.go();
  }
}
