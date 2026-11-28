/** What one notification card shows, whether it is a toast or a row of
 *  the sheet: its category, its words, where it is from and when, and
 *  the label on its button. Built here so the card itself only draws. */

import type { ModelToast } from "../clientState";
import { NotificationCategories } from "./categories";
import type { NotificationCategory } from "./category";
import type { FloorNotification } from "./model";
import { ToastTone, type Severity } from "./toastTone";

/** igni's own name, as the source of a toast igni raised. */
export const IGNI_SOURCE = "igni";

export class NotificationCard {
  constructor(
    readonly category: NotificationCategory,
    readonly severity: Severity,
    readonly title: string,
    readonly body: string,
    /** Which extension (or igni) it is from. */
    readonly source: string,
    /** The organisation, for somebody in more than one; else empty. */
    readonly org: string,
    /** Who did it, when that is not the source itself; else empty. */
    readonly actor: string,
    /** When, in words; empty when it cannot be said. */
    readonly when: string,
    readonly unread: boolean,
    /** The button's label when it points somewhere; empty when it does not. */
    readonly action: string,
  ) {}

  static fromToast(toast: ModelToast, sourceName: (id: string) => string = (id) => id): NotificationCard {
    const category = NotificationCategories.forToast(toast);
    const target = toast.target ?? null;
    return new NotificationCard(
      category,
      ToastTone.of(toast.kind).severity,
      toast.text,
      toast.body ?? "",
      toast.source ? sourceName(toast.source) : IGNI_SOURCE,
      "",
      "",
      "now",
      true,
      target ? category.actionLabel(target.kind) : "",
    );
  }

  static fromFloor(
    row: FloorNotification,
    source: string,
    openable: boolean,
    now: number = Date.now(),
  ): NotificationCard {
    const category = NotificationCategories.forFloor(row);
    return new NotificationCard(
      category,
      category.severity,
      row.title || row.kind,
      row.body,
      source,
      row.org_name ?? "",
      row.actor && row.actor !== source ? row.actor : "",
      relativeTime(row.created_at, now),
      !row.read,
      openable && row.target && category.actionable ? category.actionLabel(row.target.page) : "",
    );
  }

  /** Waits on the person and has not been dealt with: drawn louder. */
  get prominent(): boolean {
    return this.category.needsYou && this.unread;
  }

  /** The hue it is drawn in: its category's, or the warning's for a
   *  warning that belongs to no category of its own. */
  get hue(): string {
    const generic = this.category.key === "notice" || this.category.key === "extension";
    return generic && this.severity === "warning" ? "var(--warning)" : `var(${this.category.hueToken})`;
  }
}

/** How long ago `iso` was, in a word or two; empty for no date. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  const at = Date.parse(iso || "");
  if (Number.isNaN(at)) return "";
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
