/** What a notification is about, and how that reads on screen: its
 *  name, its icon, its hue, and whether it waits on the person. What its
 *  button says is where it points ({@link NotificationActions}). A closed set; {@link NotificationCategories} decides
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
    /** How a toast igni raises in it is styled and announced. */
    readonly severity: Severity = "info",
    /** Waits on the person: drawn louder than news. */
    readonly needsYou: boolean = false,
  ) {}

  /** The custom property theme.css defines for its hue, in both themes. */
  get hueToken(): string {
    return `--notify-hue-${this.key}`;
  }
}
