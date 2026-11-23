/** The list view's chrome: one header row — the Marketplace/Installed
 *  toggle on the left, and search, refresh and manage as quiet icon
 *  controls on the right. Search is an icon that expands inline, so the
 *  page opens with a single uncluttered row rather than a tabs row and a
 *  full-width search bar stacked on top of each other. */

import { useEffect, useRef, useState } from "react";

import { FilterIcon, GearIcon, RefreshIcon, SearchIcon, SortIcon, XIcon } from "../../Icons";
import { ControlMenu } from "../ControlMenu";
import { ALL_CATEGORIES, categoryLabel, SORT_OPTIONS, type SortKey } from "./catalogView";
import type { Tab } from "./pluginsView";

export function PluginsTabs({
  tab,
  catalogCount,
  installedCount,
  onSelect,
  controls,
}: {
  tab: Tab;
  catalogCount: number;
  installedCount: number;
  onSelect: (tab: Tab) => void;
  /** The right-hand icon controls, when this is the catalog view. */
  controls?: React.ReactNode;
}) {
  return (
    <div className="plugins-headerbar">
      <div className="plugins-tabs">
        <button
          className={`plugins-tab ${tab === "marketplace" ? "active" : ""}`}
          onClick={() => onSelect("marketplace")}
        >
          Marketplace
          <span className="plugins-tab-count">{catalogCount}</span>
        </button>
        <button
          className={`plugins-tab ${tab === "installed" ? "active" : ""}`}
          onClick={() => onSelect("installed")}
        >
          Installed
          <span className="plugins-tab-count">{installedCount}</span>
        </button>
      </div>
      {controls}
    </div>
  );
}

export function CatalogControls({
  pluginCount,
  marketCount,
  query,
  onQueryChange,
  categories = [],
  sortBy,
  onSortChange,
  filterBy,
  onFilterChange,
  refreshing,
  onRefresh,
  onManage,
}: {
  pluginCount: number;
  marketCount: number;
  query: string;
  onQueryChange: (query: string) => void;
  categories: string[];
  sortBy: SortKey;
  onSortChange: (sort: SortKey) => void;
  filterBy: string;
  onFilterChange: (filter: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onManage: () => void;
}) {
  // A search that is open while it has text, or while the person is using
  // it; collapses back to an icon when empty and blurred.
  const [expanded, setExpanded] = useState(false);
  // Which dropdown is open, if any — only one at a time.
  const [openMenu, setOpenMenu] = useState<"sort" | "filter" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = expanded || query.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const filterOptions = [
    { key: ALL_CATEGORIES, label: "All categories" },
    ...categories.map((c) => ({ key: c, label: categoryLabel(c) })),
  ];

  return (
    <div className="plugins-controls">
      {open ? (
        <div className="plugins-searchbox">
          <SearchIcon size={13} />
          <input
            ref={inputRef}
            className="plugins-searchbox-input"
            placeholder={`Search ${pluginCount} plugins across ${marketCount} marketplace${marketCount === 1 ? "" : "s"}…`}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onQueryChange("");
                setExpanded(false);
              }
            }}
          />
          <button
            className="plugins-searchbox-clear"
            aria-label="Close search"
            onClick={() => {
              onQueryChange("");
              setExpanded(false);
            }}
          >
            <XIcon size={10} />
          </button>
        </div>
      ) : (
        <button
          className="kb-icon-btn"
          aria-label="Search plugins"
          title="Search plugins"
          onClick={() => setExpanded(true)}
        >
          <SearchIcon />
        </button>
      )}

      <ControlMenu
        label="Filter"
        active={filterBy !== ALL_CATEGORIES}
        open={openMenu === "filter"}
        onToggle={() => setOpenMenu(openMenu === "filter" ? null : "filter")}
        onClose={() => setOpenMenu(null)}
        icon={<FilterIcon />}
        options={filterOptions}
        current={filterBy}
        onPick={(key) => onFilterChange(key)}
      />
      <ControlMenu
        label="Sort"
        active={sortBy !== "default"}
        open={openMenu === "sort"}
        onToggle={() => setOpenMenu(openMenu === "sort" ? null : "sort")}
        onClose={() => setOpenMenu(null)}
        icon={<SortIcon />}
        options={SORT_OPTIONS}
        current={sortBy}
        onPick={(key) => onSortChange(key)}
      />

      <button
        className="kb-icon-btn"
        disabled={refreshing}
        onClick={onRefresh}
        aria-label="Refresh catalogs"
        title="Re-fetch marketplace catalogs"
      >
        {refreshing ? <span className="plugins-spinner" aria-hidden="true" /> : <RefreshIcon />}
      </button>
      <button
        className="kb-icon-btn"
        onClick={onManage}
        title="Manage marketplaces"
        aria-label="Manage marketplaces"
      >
        <GearIcon />
      </button>
    </div>
  );
}

