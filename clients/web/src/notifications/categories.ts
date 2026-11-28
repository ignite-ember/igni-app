/** Every notification category, and the one place a notification is
 *  sorted into one. "Needs you" only for a decision that is still
 *  waiting ({@link NotificationActions}); otherwise a floor row by its
 *  `kind`, a toast by the category igni gave it or, for an extension's,
 *  by its severity. Words in a kind pick an icon and a hue, never a
 *  decision. */

import type { ModelToast } from "../clientState";
import { NotificationCategory, type CategoryKey } from "./category";
import type { FloorNotification } from "./model";
import type { NotificationAction } from "./notificationAction";

/** The words in a floor row's `kind` that place it, first match wins:
 *  a failure outranks what failed. No word makes a decision. */
const KIND_WORDS: readonly (readonly [Exclude<CategoryKey, "approval">, readonly string[]])[] = [
  ["failed", ["error", "errored", "fail", "failed", "failure", "crash", "crashed", "broken", "timeout", "rejected"]],
  ["people", ["mention", "mentioned", "comment", "reply", "message", "chat", "dm", "invite", "share", "shared", "assigned"]],
  ["update", ["update", "release", "upgrade", "version"]],
  ["background", ["schedule", "scheduled", "scheduler", "cron", "watcher", "watch", "background", "workflow", "job", "task", "process"]],
  ["done", ["done", "finished", "complete", "completed", "ready", "success", "succeeded", "passed", "export", "ci", "build", "deploy"]],
];

export class NotificationCategories {
  static readonly ALL: readonly NotificationCategory[] = [
    new NotificationCategory("approval", "Needs you", "info", true),
    new NotificationCategory("failed", "Failed", "error"),
    new NotificationCategory("done", "Finished", "success"),
    new NotificationCategory("background", "Background"),
    new NotificationCategory("people", "Mentions"),
    new NotificationCategory("update", "Updates", "info"),
    new NotificationCategory("extension", "Extensions"),
    new NotificationCategory("notice", "Notices"),
  ];

  private static readonly BY_KEY = new Map(NotificationCategories.ALL.map((c) => [c.key, c]));

  /** The category called `key`; `null` for a key that is not one. */
  static find(key: string | null | undefined): NotificationCategory | null {
    return NotificationCategories.BY_KEY.get(key as CategoryKey) ?? null;
  }

  /** The category called `key`, which must be one. */
  static of(key: CategoryKey): NotificationCategory {
    return NotificationCategories.BY_KEY.get(key) as NotificationCategory;
  }

  /** A floor row's: a waiting decision's, else by the words in its
   *  kind, else its extension's. */
  static forFloor(row: Pick<FloorNotification, "kind">, action: NotificationAction | null = null): NotificationCategory {
    if (action?.decides) return NotificationCategories.of("approval");
    return NotificationCategories.fromKind(row.kind) ?? NotificationCategories.of("extension");
  }

  /** A toast's: a waiting decision's, else the category igni named
   *  (never a decision), else its severity's, else whose it is. */
  static forToast(
    toast: Pick<ModelToast, "kind" | "category" | "source">,
    action: NotificationAction | null = null,
  ): NotificationCategory {
    if (action?.decides) return NotificationCategories.of("approval");
    const named = NotificationCategories.find(toast.category);
    if (named && !named.needsYou) return named;
    if (toast.kind === "error") return NotificationCategories.of("failed");
    if (toast.kind === "success") return NotificationCategories.of("done");
    return NotificationCategories.of(toast.source ? "extension" : "notice");
  }

  /** The category the words of a `kind` name; `null` when none do. */
  static fromKind(kind: string | null | undefined): NotificationCategory | null {
    const words = new Set((kind ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    for (const [key, cues] of KIND_WORDS) {
      if (cues.some((cue) => words.has(cue))) return NotificationCategories.of(key);
    }
    return null;
  }
}
