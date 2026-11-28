/** The sheet's category filter: a chip per category its rows fall into,
 *  its icon and count in the category's hue, its name once chosen.
 *  Choosing the chosen one again shows every category. Drawn only when
 *  there is more than one category to choose between. */

import type { CSSProperties } from "react";

import type { CategoryKey } from "../notifications/category";
import type { CategoryChip } from "../notifications/categoryFilter";
import { CategoryIcon } from "./Icons";

export function CategoryChips({
  chips,
  current,
  onSelect,
}: {
  chips: readonly CategoryChip[];
  current: CategoryKey | null;
  onSelect: (key: CategoryKey | null) => void;
}) {
  if (chips.length < 2) return null;
  return (
    <div className="notify-chips" role="group" aria-label="Filter by category">
      {chips.map(({ category, count }) => (
        <button
          key={category.key}
          type="button"
          className={`notify-chip notify-chip--${category.key}`}
          style={{ "--ncard-hue": `var(${category.hueToken})` } as CSSProperties}
          aria-pressed={current === category.key}
          aria-label={`${category.label}, ${count}`}
          title={current === category.key ? "Show every category" : `Only ${category.label.toLowerCase()}`}
          onClick={() => onSelect(current === category.key ? null : category.key)}
        >
          <CategoryIcon category={category.key} size={13} />
          {current === category.key && <span className="notify-chip-label">{category.label}</span>}
          <span className="notify-chip-count">{count}</span>
        </button>
      ))}
    </div>
  );
}
