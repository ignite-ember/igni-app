/** What a notification is about, and how that reads on screen: its
 *  name, its icon, its hue, the verb on its button and whether it waits
 *  on the person. A closed set; {@link NotificationCategories} decides
 *  which one a notification belongs to. */

import type { Severity } from "./toastTone";

export type CategoryKey =
  | "approval"
  | "failed"
  | "done"
  | "background"
  | "people"
  | "update"
  | "extension"
  | "notice";

export class NotificationCategory {
  constructor(
    readonly key: CategoryKey,
    /** The category's name, on its filter chip and to a screen reader. */
    readonly label: string,
    /** The verb on the card's button when it points somewhere. */
    readonly verb: string,
    /** How a toast igni raises in it is styled and announced. */
    readonly severity: Severity = "info",
    /** Waits on the person: drawn louder than news. */
    readonly needsYou: boolean = false,
    /** Its rows in the sheet carry a button, not only a click target. */
    readonly actionable: boolean = needsYou,
  ) {}

  /** The custom property theme.css defines for its hue, in both themes. */
  get hueToken(): string {
    return `--notify-hue-${this.key}`;
  }

  /** The button's label for a notification pointing at `page`. */
  actionLabel(page: string | null | undefined): string {
    if (this.key === "failed" && page && CHAT_PAGES.has(page)) return "Open chat";
    return this.verb;
  }
}

/** Pages that are a conversation: a failure there opens the chat. */
const CHAT_PAGES = new Set(["session", "chat"]);
