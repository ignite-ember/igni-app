import { useMemo, useState } from "react";
import type { IgniClient } from "../../protocol/client";
import type { PanelLevels } from "../PageShell";
import { Drawer } from "./Drawer";
import { ALL_CATEGORIES, categoriesOf, type SortKey } from "./plugins/catalogView";
import { CatalogControls, PluginsTabs } from "./plugins/PluginsChrome";
import { PluginsApi } from "./plugins/pluginsApi";
import { PluginsPage, type PluginsPageContext } from "./plugins/pluginsPages";
import { PluginsView } from "./plugins/pluginsView";
import { usePluginContents } from "./plugins/usePluginContents";
import { usePlugins } from "./plugins/usePlugins";

export interface PluginsPanelProps {
  client: IgniClient;
  onClose: () => void;
}

/**
 * Plugins panel: the marketplace catalog and the installed plugins as
 * two tabs, each plugin's own page one level down, and marketplace
 * management beside them. This composes the pieces in `plugins/`; it
 * holds only where the panel is and what is being typed.
 */
export function PluginsPanel({ client, onClose }: PluginsPanelProps) {
  const api = useMemo(() => new PluginsApi(client), [client]);
  const plugins = usePlugins(api);
  const [view, setView] = useState(() => PluginsView.initial());
  const [installRef, setInstallRef] = useState("");
  const [marketUrl, setMarketUrl] = useState("");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("default");
  const [filterBy, setFilterBy] = useState<string>(ALL_CATEGORIES);

  const categories = useMemo(
    () => categoriesOf(plugins.catalog?.entries() ?? []),
    [plugins.catalog],
  );

  const screen = view.screen(plugins.installed);
  const contents = usePluginContents(api, screen.page === "detail" ? screen.resolved : null);
  const levels = useMemo<PanelLevels>(
    () => ({
      labels: view.crumbs,
      onTruncate: (i) => setView((v) => v.truncate(i)),
    }),
    [view],
  );

  const ctx: PluginsPageContext = {
    plugins,
    contents,
    fields: {
      installRef: { value: installRef, set: setInstallRef },
      marketUrl: { value: marketUrl, set: setMarketUrl },
      query: { value: query, set: setQuery },
    },
    catalogView: { sortBy, filterBy },
    go: setView,
  };

  const controls =
    view.showsCatalogToolbar && plugins.catalog !== null ? (
      <CatalogControls
        pluginCount={plugins.catalog.pluginCount}
        marketCount={plugins.catalog.marketCount}
        query={query}
        onQueryChange={setQuery}
        categories={categories}
        sortBy={sortBy}
        onSortChange={setSortBy}
        filterBy={filterBy}
        onFilterChange={setFilterBy}
        refreshing={plugins.refreshing}
        onRefresh={plugins.refreshMarketplaces}
        onManage={() => setView((v) => v.manageMarkets())}
      />
    ) : null;

  const headerExtras = view.showsTabs ? (
    <PluginsTabs
      tab={view.tab}
      catalogCount={plugins.catalog?.pluginCount ?? 0}
      installedCount={plugins.installed?.count ?? 0}
      onSelect={(tab) => setView((v) => v.withTab(tab))}
      controls={controls}
    />
  ) : null;

  return (
    <Drawer
      title={view.title}
      levels={levels}
      // The plugin's page opens with its own name in the hero.
      titleInBody={screen.page === "detail"}
      onClose={onClose}
      headerExtras={headerExtras}
    >
      {plugins.error && (
        <div className="msg-error msg-error--banner">{`Error: ${plugins.error.reason}`}</div>
      )}
      <PluginsPage screen={screen} ctx={ctx} />
    </Drawer>
  );
}
