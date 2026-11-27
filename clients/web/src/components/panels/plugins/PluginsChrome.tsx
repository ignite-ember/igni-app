/** The list view's chrome: one header row — the Marketplace/Installed
 *  toggle on the left, and search, filter, sort, refresh and manage as
 *  quiet icon controls on the right. Both halves are the shared page
 *  pieces (`PageTabs`, `PageHeaderControls`); this only says what the
 *  plugins page puts in them. */

import { PageHeaderControls } from "../../page/PageHeaderControls";
import { PageTabs } from "../../page/PageTabs";
import { ALL_CATEGORIES, categoryLabel, SORT_OPTIONS, type SortKey } from "./catalogView";
import { CategoryIcon } from "./categoryIcon";
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
    <PageTabs<Tab>
      tabs={[
        { key: "marketplace", label: "Marketplace", count: catalogCount },
        { key: "installed", label: "Installed", count: installedCount },
      ]}
      current={tab}
      onSelect={onSelect}
      controls={controls}
    />
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
  const filterOptions = [
    { key: ALL_CATEGORIES, label: "All categories" },
    ...categories.map((c) => ({
      key: c,
      label: categoryLabel(c),
      icon: <CategoryIcon category={c} />,
    })),
  ];

  return (
    <PageHeaderControls
      search={{
        value: query,
        onChange: onQueryChange,
        label: "Search plugins",
        placeholder: `Search ${pluginCount} plugins across ${marketCount} marketplace${marketCount === 1 ? "" : "s"}…`,
      }}
      filter={{
        options: filterOptions,
        current: filterBy,
        onPick: onFilterChange,
        active: filterBy !== ALL_CATEGORIES,
      }}
      sort={{
        options: SORT_OPTIONS,
        current: sortBy,
        onPick: onSortChange,
        active: sortBy !== "default",
      }}
      refresh={{
        onClick: onRefresh,
        busy: refreshing,
        label: "Refresh catalogs",
        title: "Re-fetch marketplace catalogs",
      }}
      settings={{ onClick: onManage, label: "Manage marketplaces" }}
    />
  );
}
