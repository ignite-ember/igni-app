/** The Marketplace tab: every registered marketplace's plugins, searched,
 *  as a grid of cards. */

import { CheckIcon } from "../../Icons";
import { CardGrid } from "../../page/CardGrid";
import { CardGridSkeleton } from "../../page/CardGridSkeleton";
import { EntityCard } from "../../page/EntityCard";
import { PageEmpty } from "../../page/PageEmpty";
import { categoryLabel } from "./catalogView";
import { CategoryIcon } from "./categoryIcon";
import type { InstalledPlugins } from "./installedPlugin";
import type { CatalogEntry, MarketplaceCatalog, MarketplacePlugin } from "./marketplace";
import { PluginAction } from "./pluginAction";

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
  if (catalog === null) return <CardGridSkeleton />;
  if (entries.length === 0) {
    const none = catalog.marketCount === 0;
    return (
      <PageEmpty
        title={none ? "No marketplaces configured" : "No plugins match"}
        hint={
          none
            ? "Add a marketplace URL or install by Git ref above."
            : "Try a different search, or refresh the catalogs."
        }
      />
    );
  }
  // Every card carrying the same marketplace name is just noise; show
  // the source only when there is more than one to tell apart.
  const showSource = catalog.marketCount > 1;
  return (
    <CardGrid>
      {entries.map((entry) => {
        const { market, plugin } = entry;
        const isInstalled = installed.has(plugin.name);
        const busy = isRunning(PluginAction.plugin(plugin.name));
        return (
          <EntityCard
            key={`${market}:${plugin.name}`}
            name={plugin.name}
            onOpen={() => onOpen(entry)}
            icon={
              plugin.category ? (
                <span className="entity-glyph plugins-cat-avatar" style={{ width: 38, height: 38 }}>
                  <CategoryIcon category={plugin.category} size={20} />
                </span>
              ) : undefined
            }
            action={
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
            }
            description={plugin.description}
            footer={
              (plugin.category || showSource || plugin.version) && (
                <>
                  {plugin.category && (
                    <span className="plugins-cat-chip">{categoryLabel(plugin.category)}</span>
                  )}
                  {showSource && <span className="plugins-source">{market}</span>}
                  {plugin.version && <span className="plugins-version">{plugin.version}</span>}
                </>
              )
            }
          />
        );
      })}
    </CardGrid>
  );
}
