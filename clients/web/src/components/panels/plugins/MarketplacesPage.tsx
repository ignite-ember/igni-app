/** Marketplace management: register one by URL, refresh or unregister. */

import { NamedIcon, RefreshIcon } from "../../Icons";
import { Button } from "../../page/Button";
import { CardGridSkeleton } from "../../page/CardGridSkeleton";
import type { MarketplaceCatalog } from "./marketplace";
import { PluginAction } from "./pluginAction";

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
  if (catalog === null) return <CardGridSkeleton />;
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
        <Button
          variant="primary"
          icon={<NamedIcon name="plus" size={14} />}
          disabled={!marketUrl.trim()}
          busy={adding}
          onClick={() => onAddMarketplace(marketUrl.trim())}
        >
          Add marketplace
        </Button>
      </div>

      <div className="plugins-markets-list">
        <div className="plugins-markets-list-head">
          <span>Registered marketplaces ({catalog.marketCount})</span>
          <Button
            size="sm"
            icon={<RefreshIcon size={13} />}
            disabled={catalog.marketCount === 0}
            busy={refreshing}
            onClick={onRefresh}
            title="Re-fetch all marketplace catalogs"
          >
            Refresh all
          </Button>
        </div>
        {catalog.marketCount === 0 ? (
          <div className="page-empty">
            <div className="page-empty-title">No marketplaces registered</div>
            <div className="page-empty-hint">Add one above to populate the catalog.</div>
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
                <Button
                  variant="danger"
                  size="sm"
                  disabled={removable === null}
                  busy={removing}
                  onClick={() => removable !== null && onRemoveMarketplace(removable)}
                  title={removable !== null ? `Unregister ${removable}` : "Cannot remove (no name)"}
                >
                  Remove
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
