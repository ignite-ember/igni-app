/** The Marketplace tab: every registered marketplace's plugins, searched. */

import type { InstalledPlugins } from "./installedPlugin";
import type { CatalogEntry, MarketplaceCatalog, MarketplacePlugin } from "./marketplace";
import { PluginAction } from "./pluginAction";
import { PluginsSkeleton } from "./PluginParts";

export function MarketplaceTab({
  catalog,
  entries,
  installed,
  isRunning,
  onInstall,
  onOpen,
}: {
  catalog: MarketplaceCatalog | null;
  /** The catalog's entries the search matches. */
  entries: CatalogEntry[];
  installed: InstalledPlugins;
  isRunning: (action: PluginAction) => boolean;
  onInstall: (plugin: MarketplacePlugin) => void;
  onOpen: (entry: CatalogEntry) => void;
}) {
  if (catalog === null) return <PluginsSkeleton />;
  if (entries.length === 0) {
    const none = catalog.marketCount === 0;
    return (
      <div className="plugins-empty">
        <div className="plugins-empty-title">
          {none ? "No marketplaces configured" : "No plugins match"}
        </div>
        <div className="plugins-empty-hint">
          {none
            ? "Add a marketplace URL or install by Git ref above."
            : "Try a different search, or refresh the catalogs."}
        </div>
      </div>
    );
  }
  return (
    <div className="plugins-list">
      {entries.map((entry) => {
        const { market, plugin } = entry;
        const isInstalled = installed.has(plugin.name);
        const busy = isRunning(PluginAction.plugin(plugin.name));
        return (
          <div
            className="plugins-card plugins-card-clickable"
            key={`${market}:${plugin.name}`}
            onClick={() => onOpen(entry)}
          >
            <div className="plugins-card-head">
              <div className="plugins-card-title">
                <span className="plugins-name">{plugin.name}</span>
                {plugin.version && <span className="plugins-version">{plugin.version}</span>}
                <span className="plugins-source">{market}</span>
                {isInstalled && <span className="plugins-tag">installed</span>}
              </div>
              {isInstalled ? (
                <span className="plugins-chevron-end">›</span>
              ) : (
                <div className="plugins-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy}
                    onClick={() => onInstall(plugin)}
                    title={`Install from ${plugin.source}`}
                  >
                    {busy ? "…" : "Install"}
                  </button>
                </div>
              )}
            </div>
            {plugin.description && <div className="plugins-desc">{plugin.description}</div>}
          </div>
        );
      })}
    </div>
  );
}
