/** Notifications grouped by the day they arrived, newest day first:
 *  Today, Yesterday, a weekday within the week, then the date. */

import type { FloorNotification } from "./model";

/** One day's notifications, in the order the backend sent them. */
export interface DayGroup {
  /** Stable per day: `2026-11-28`, or `undated`. */
  key: string;
  label: string;
  rows: FloorNotification[];
}

const DAY_MS = 86_400_000;
const UNDATED = "undated";

export class NotificationDays {
  private readonly today: number;

  constructor(
    now: Date = new Date(),
    private readonly locale: string | undefined = undefined,
  ) {
    this.today = NotificationDays.startOfDay(now.getTime());
  }

  /** The rows, one group per local day; rows without a date go last. */
  group(rows: readonly FloorNotification[]): DayGroup[] {
    const byDay = new Map<string, { start: number; group: DayGroup }>();
    for (const row of rows) {
      const at = Date.parse(row.created_at ?? "");
      const start = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : NotificationDays.startOfDay(at);
      const key = Number.isNaN(at) ? UNDATED : NotificationDays.keyOf(start);
      const known = byDay.get(key);
      if (known) known.group.rows.push(row);
      else byDay.set(key, { start, group: { key, label: this.label(start), rows: [row] } });
    }
    return [...byDay.values()].sort((a, b) => b.start - a.start).map((entry) => entry.group);
  }

  /** What a day's heading says. */
  label(dayStart: number): string {
    if (!Number.isFinite(dayStart)) return "Earlier";
    const daysAgo = Math.round((this.today - dayStart) / DAY_MS);
    if (daysAgo <= 0) return "Today";
    if (daysAgo === 1) return "Yesterday";
    const date = new Date(dayStart);
    if (daysAgo < 7) return date.toLocaleDateString(this.locale, { weekday: "long" });
    const sameYear = date.getFullYear() === new Date(this.today).getFullYear();
    return date.toLocaleDateString(this.locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  }

  private static startOfDay(ms: number): number {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  private static keyOf(dayStart: number): string {
    const d = new Date(dayStart);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}
