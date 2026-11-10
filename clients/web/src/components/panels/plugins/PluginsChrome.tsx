/** The list view's chrome: the tabs in the header, and the catalog's
 *  search-and-manage toolbar. */

import { GearIcon } from "../../Icons";
import type { Tab } from "./pluginsView";

export function PluginsTabs({
  tab,
  catalogCount,
  installedCount,
  onSelect,
}: {
  tab: Tab;
  catalogCount: number;
  installedCount: number;
  onSelect: (tab: Tab) => void;
}) {
  return (
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
  );
}

export function CatalogToolbar({
  pluginCount,
  marketCount,
  query,
  onQueryChange,
  refreshing,
  onRefresh,
  onManage,
}: {
  pluginCount: number;
  marketCount: number;
  query: string;
  onQueryChange: (query: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onManage: () => void;
}) {
  return (
    <div className="plugins-toolbar">
      <input
        className="panel-input plugins-search"
        placeholder={`Search ${pluginCount} plugins across ${marketCount} marketplace${marketCount === 1 ? "" : "s"}…`}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <button
        className="btn btn-sm"
        disabled={refreshing}
        onClick={onRefresh}
        title="Re-fetch marketplace catalogs"
      >
        {refreshing ? "…" : "Refresh"}
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
