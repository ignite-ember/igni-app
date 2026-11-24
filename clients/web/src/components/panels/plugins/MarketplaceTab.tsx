/** The Marketplace tab: every registered marketplace's plugins, searched,
 *  as a grid of cards. */

import { CheckIcon } from "../../Icons";
import { EntityGlyph } from "../../EntityGlyph";
import { categoryLabel } from "./catalogView";
import { CategoryIcon } from "./categoryIcon";
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
  // Every card carrying the same marketplace name is just noise; show
  // the source only when there is more than one to tell apart.
  const showSource = catalog.marketCount > 1;
  return (
    <div className="plugins-grid">
      {entries.map((entry) => {
        const { market, plugin } = entry;
        const isInstalled = installed.has(plugin.name);
        const busy = isRunning(PluginAction.plugin(plugin.name));
        return (
          <div
            className="plugins-gcard"
            key={`${market}:${plugin.name}`}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(entry)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(entry);
              }
            }}
          >
            <span className="plugins-gcard-icon" aria-hidden="true">
              <EntityGlyph name={plugin.name} size={38} />
            </span>
            <div className="plugins-gcard-body">
              <div className="plugins-gcard-top">
                <span className="plugins-name">{plugin.name}</span>
                <button
                  type="button"
                  className={`plugins-add${isInstalled ? " is-installed" : ""}`}
                  disabled={busy || isInstalled}
                  aria-label={isInstalled ? "Installed" : "Install"}
                  title={isInstalled ? "Installed" : `Install from ${plugin.source}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isInstalled && !busy) onInstall(plugin);
                  }}
                >
                  {busy ? "…" : isInstalled ? <CheckIcon size={12} /> : "+"}
                </button>
              </div>
              {plugin.description && <p className="plugins-gcard-desc">{plugin.description}</p>}
              {(plugin.category || showSource || plugin.version) && (
                <div className="plugins-gcard-foot">
                  {plugin.category && (
                    <span className="plugins-cat-chip">
                      <CategoryIcon category={plugin.category} size={12} />
                      {categoryLabel(plugin.category)}
                    </span>
                  )}
                  {showSource && <span className="plugins-source">{market}</span>}
                  {plugin.version && <span className="plugins-version">{plugin.version}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
