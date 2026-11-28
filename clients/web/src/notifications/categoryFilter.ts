/** The sheet's category filter: which categories its rows fall into,
 *  how many each, and the rows of the one chosen. */

import { NotificationCategories } from "./categories";
import type { CategoryKey, NotificationCategory } from "./category";
import type { FloorNotification } from "./model";

/** One filter chip: a category the rows have, and how many. */
export interface CategoryChip {
  category: NotificationCategory;
  count: number;
}

export class CategoryFilter {
  constructor(private readonly rows: readonly FloorNotification[]) {}

  /** A chip per category present, in the registry's order. */
  chips(): CategoryChip[] {
    const counts = new Map<CategoryKey, number>();
    for (const row of this.rows) {
      const key = NotificationCategories.forFloor(row).key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return NotificationCategories.ALL.filter((c) => counts.has(c.key)).map((category) => ({
      category,
      count: counts.get(category.key) as number,
    }));
  }

  /** `key` while some row is in it; `null` (all) once none is. */
  active(key: CategoryKey | null): CategoryKey | null {
    return key !== null && this.rows.some((row) => NotificationCategories.forFloor(row).key === key) ? key : null;
  }

  /** Which of `rows` are in `key`; all of them for `null`. */
  static apply(rows: readonly FloorNotification[], key: CategoryKey | null): FloorNotification[] {
    return key === null ? [...rows] : rows.filter((row) => NotificationCategories.forFloor(row).key === key);
  }
}
