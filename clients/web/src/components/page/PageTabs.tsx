/** A page header's one row: tabs with pill counts on the left, the
 *  page's icon controls ({@link PageHeaderControls}) on the right.
 *  Pass it as the frame's `headerExtras`; the active tab's count takes
 *  the orange gradient. */

import type { ReactNode } from "react";

export interface PageTab<K extends string> {
  key: K;
  label: string;
  /** Drawn as a pill after the label when given. */
  count?: number;
}

export function PageTabs<K extends string>({
  tabs,
  current,
  onSelect,
  controls,
}: {
  tabs: readonly PageTab<K>[];
  current: K;
  onSelect: (key: K) => void;
  controls?: ReactNode;
}) {
  return (
    <div className="page-headerbar">
      <div className="page-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`page-tab ${current === t.key ? "active" : ""}`}
            onClick={() => onSelect(t.key)}
          >
            {t.label}
            {t.count !== undefined && <span className="page-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      {controls}
    </div>
  );
}
