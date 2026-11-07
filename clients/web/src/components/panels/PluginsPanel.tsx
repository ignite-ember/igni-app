import { useMemo, useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { Drawer } from "./Drawer";
import { InstalledPlugins } from "./plugins/installedPlugin";
import { InstalledTab } from "./plugins/InstalledTab";
import { MarketplacesPage } from "./plugins/MarketplacesPage";
import { MarketplaceTab } from "./plugins/MarketplaceTab";
import { PluginAction } from "./plugins/pluginAction";
import { PluginDetailPage } from "./plugins/PluginDetailPage";
import { CatalogToolbar, PluginsTabs } from "./plugins/PluginsChrome";
import { PluginsApi } from "./plugins/pluginsApi";
import { PluginSelection } from "./plugins/pluginSelection";
import { PluginsView } from "./plugins/pluginsView";
import { usePluginContents } from "./plugins/usePluginContents";
import { usePlugins } from "./plugins/usePlugins";

/**
 * Plugins panel: the marketplace catalog and the installed plugins as
 * two tabs, each plugin's own page one level down, and marketplace
 * management beside them. This composes the pieces in `plugins/`; it
 * holds only where the panel is and what is being typed.
 */
export function PluginsPanel({ client, onClose }: { client: IgniClient; onClose: () => void }) {
  const api = useMemo(() => new PluginsApi(client), [client]);
  const plugins = usePlugins(api);
  const [view, setView] = useState(() => PluginsView.initial());
  const [installRef, setInstallRef] = useState("");
  const [marketUrl, setMarketUrl] = useState("");
  const [query, setQuery] = useState("");

  const resolved = view.selection?.resolve(plugins.installed) ?? null;
  const contents = usePluginContents(api, resolved);
  const { installed, catalog, isRunning } = plugins;
  const back = () => setView((v) => v.back());

  const levels = { labels: view.leaf ? [view.leaf] : [], onTruncate: back };

  const headerExtras = view.showsTabs ? (
    <PluginsTabs
      tab={view.tab}
      catalogCount={catalog?.pluginCount ?? 0}
      installedCount={installed?.count ?? 0}
      onSelect={(tab) => setView((v) => v.withTab(tab))}
    />
  ) : null;

  const toolbar =
    view.showsCatalogToolbar && catalog !== null ? (
      <CatalogToolbar
        pluginCount={catalog.pluginCount}
        marketCount={catalog.marketCount}
        query={query}
        onQueryChange={setQuery}
        refreshing={isRunning(PluginAction.refresh())}
        onRefresh={plugins.refreshMarketplaces}
        onManage={() => setView((v) => v.manageMarkets())}
      />
    ) : null;

  return (
    <Drawer
      title={view.title}
      levels={levels}
      onClose={onClose}
      headerExtras={headerExtras}
      toolbar={toolbar}
    >
      {plugins.error && (
        <div className="msg-error" style={{ marginBottom: 10 }}>
          {`Error: ${plugins.error}`}
        </div>
      )}

      {resolved ? (
        <PluginDetailPage
          resolved={resolved}
          contents={contents}
          isRunning={isRunning}
          onInstall={(p) => plugins.install(p.source, PluginAction.plugin(p.name))}
          onToggle={plugins.toggle}
          onRemove={(p) => plugins.remove(p, back)}
        />
      ) : view.isMarkets ? (
        <MarketplacesPage
          catalog={catalog}
          marketUrl={marketUrl}
          onMarketUrlChange={setMarketUrl}
          isRunning={isRunning}
          onAddMarketplace={(url) => plugins.addMarketplace(url, () => setMarketUrl(""))}
          onRemoveMarketplace={plugins.removeMarketplace}
          onRefresh={plugins.refreshMarketplaces}
        />
      ) : view.tab === "installed" ? (
        <InstalledTab
          installed={installed}
          installRef={installRef}
          onInstallRefChange={setInstallRef}
          installing={isRunning(PluginAction.installRef())}
          onInstall={(ref) =>
            plugins.install(ref, PluginAction.installRef(), () => setInstallRef(""))
          }
          onOpen={(p) => setView((v) => v.open(PluginSelection.installed(p)))}
        />
      ) : (
        <MarketplaceTab
          catalog={catalog}
          entries={catalog?.filter(query) ?? []}
          installed={installed ?? InstalledPlugins.EMPTY}
          isRunning={isRunning}
          onInstall={(p) => plugins.install(p.source, PluginAction.plugin(p.name))}
          onOpen={(entry) => setView((v) => v.open(PluginSelection.fromCatalog(entry)))}
        />
      )}
    </Drawer>
  );
}
