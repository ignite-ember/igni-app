/** Marketplace management: register one by URL, refresh or unregister. */

import type { MarketplaceCatalog } from "./marketplace";
import { PluginAction } from "./pluginAction";
import { PluginsSkeleton } from "./PluginParts";

export function MarketplacesPage({
  catalog,
  marketUrl,
  onMarketUrlChange,
  isRunning,
  onAddMarketplace,
  onRemoveMarketplace,
  onRefresh,
}: {
  catalog: MarketplaceCatalog | null;
  marketUrl: string;
  onMarketUrlChange: (url: string) => void;
  isRunning: (action: PluginAction) => boolean;
  onAddMarketplace: (url: string) => void;
  onRemoveMarketplace: (name: string) => void;
  onRefresh: () => void;
}) {
  if (catalog === null) return <PluginsSkeleton />;
  const adding = isRunning(PluginAction.addMarketplace());
  const refreshing = isRunning(PluginAction.refresh());
  return (
    <div className="plugins-markets-page">
      <div className="plugins-install-label">Add marketplace</div>
      <div className="plugins-section-hint">
        A marketplace is a git repo whose <code>.claude-plugin/marketplace.json</code>{" "}
        catalogues many plugins. Registering one lets you browse and install from its full
        catalog.
      </div>
      <div className="plugins-toolbar plugins-add-market">
        <input
          className="panel-input"
          placeholder="github.com/owner/repo or git URL…"
          value={marketUrl}
          onChange={(e) => onMarketUrlChange(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && marketUrl.trim() && onAddMarketplace(marketUrl.trim())
          }
          autoFocus
        />
        <button
          className="btn btn-sm btn-primary"
          disabled={!marketUrl.trim() || adding}
          onClick={() => onAddMarketplace(marketUrl.trim())}
        >
          {adding ? "…" : "Add marketplace"}
        </button>
      </div>

      <div className="plugins-markets-list">
        <div className="plugins-markets-list-head">
          <span>Registered marketplaces ({catalog.marketCount})</span>
          <button
            className="btn btn-sm"
            disabled={refreshing || catalog.marketCount === 0}
            onClick={onRefresh}
            title="Re-fetch all marketplace catalogs"
          >
            {refreshing ? "…" : "Refresh all"}
          </button>
        </div>
        {catalog.marketCount === 0 ? (
          <div className="plugins-empty">
            <div className="plugins-empty-title">No marketplaces registered</div>
            <div className="plugins-empty-hint">Add one above to populate the catalog.</div>
          </div>
        ) : (
          catalog.markets.map((m) => {
            const removable = m.removableName;
            const removing =
              removable !== null && isRunning(PluginAction.removeMarketplace(removable));
            return (
              <div className="plugins-market" key={m.displayName}>
                <div className="plugins-market-main">
                  <div className="plugins-market-name">{m.displayName}</div>
                  <div className="plugins-market-url">{m.url}</div>
                  <div className="plugins-market-meta">
                    {m.pluginCount} plugins
                    {m.lastFetched && ` · fetched ${m.lastFetched}`}
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-danger"
                  disabled={removing || removable === null}
                  onClick={() => removable !== null && onRemoveMarketplace(removable)}
                  title={removable !== null ? `Unregister ${removable}` : "Cannot remove (no name)"}
                >
                  {removing ? "…" : "Remove"}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
