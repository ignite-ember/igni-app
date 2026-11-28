/** The sheet's category filter: which categories its rows fall into,
 *  how many each, and the rows of the one chosen. Rows are placed the
 *  way their cards are, a waiting decision included. */

import { NotificationCategories } from "./categories";
import type { CategoryKey, NotificationCategory } from "./category";
import type { FloorNotification } from "./model";

/** One filter chip: a category the rows have, and how many. */
export interface CategoryChip {
  category: NotificationCategory;
  count: number;
}

/** Which category a row's card wears. */
export type Categorize = (row: FloorNotification) => NotificationCategory;

export class CategoryFilter {
  constructor(
    private readonly rows: readonly FloorNotification[],
    private readonly categorize: Categorize = (row) => NotificationCategories.forFloor(row),
  ) {}

  /** A chip per category present, in the registry's order. */
  chips(): CategoryChip[] {
    const counts = new Map<CategoryKey, number>();
    for (const row of this.rows) {
      const key = this.categorize(row).key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return NotificationCategories.ALL.filter((c) => counts.has(c.key)).map((category) => ({
      category,
      count: counts.get(category.key) as number,
    }));
  }

  /** `key` while some row is in it; `null` (all) once none is. */
  active(key: CategoryKey | null): CategoryKey | null {
    return key !== null && this.rows.some((row) => this.categorize(row).key === key) ? key : null;
  }

  /** Which of `rows` are in `key`; all of them for `null`. */
  apply(rows: readonly FloorNotification[], key: CategoryKey | null): FloorNotification[] {
    return key === null ? [...rows] : rows.filter((row) => this.categorize(row).key === key);
  }
}
