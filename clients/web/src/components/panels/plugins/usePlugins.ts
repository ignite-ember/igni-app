/** The plugins panel's lists and the change it has in flight. */

import { useCallback, useEffect, useState } from "react";
import { InstalledPlugins, type InstalledPlugin } from "./installedPlugin";
import { MarketplaceCatalog } from "./marketplace";
import { PluginAction } from "./pluginAction";
import type { PluginsApi } from "./pluginsApi";
import type { ActionResult } from "./pluginWire";

export interface PluginsState {
  /** ``null`` until first read. */
  installed: InstalledPlugins | null;
  catalog: MarketplaceCatalog | null;
  /** The last failure's reason, or empty. */
  error: string;
  isRunning: (action: PluginAction) => boolean;
  install: (ref: string, action: PluginAction, onDone?: () => void) => void;
  toggle: (plugin: InstalledPlugin) => void;
  remove: (plugin: InstalledPlugin, onDone: () => void) => void;
  addMarketplace: (url: string, onDone: () => void) => void;
  removeMarketplace: (name: string) => void;
  refreshMarketplaces: () => void;
}

export function usePlugins(api: PluginsApi): PluginsState {
  const [installed, setInstalled] = useState<InstalledPlugins | null>(null);
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [pending, setPending] = useState<PluginAction | null>(null);
  const [error, setError] = useState("");

  /** Re-read both lists. The installed list's failure is shown; the
   *  catalog's reads as no marketplaces, which the page already explains. */
  const refresh = useCallback(async () => {
    const mine = await api.installed();
    if (mine.ok) {
      setInstalled(mine.value);
    } else {
      setError(mine.reason);
      setInstalled(InstalledPlugins.EMPTY);
    }
    const markets = await api.catalog();
    setCatalog(markets.ok ? markets.value : MarketplaceCatalog.EMPTY);
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Run one change. On success ``onDone`` runs first (clearing a field,
   *  leaving a page), then the lists are re-read; the action stays
   *  pending until both are done. */
  const run = useCallback(
    async (action: PluginAction, call: () => Promise<ActionResult>, onDone?: () => void) => {
      setPending(action);
      setError("");
      const result = await call();
      if (result.ok) {
        onDone?.();
        await refresh();
      } else {
        setError(result.reason);
      }
      setPending(null);
    },
    [refresh],
  );

  return {
    installed,
    catalog,
    error,
    isRunning: (action) => pending?.is(action) ?? false,
    install: (ref, action, onDone) => void run(action, () => api.install(ref), onDone),
    toggle: (plugin) =>
      void run(PluginAction.plugin(plugin.name), () =>
        api.setEnabled(plugin.name, !plugin.enabled),
      ),
    remove: (plugin, onDone) =>
      void run(PluginAction.plugin(plugin.name), () => api.remove(plugin.name), onDone),
    addMarketplace: (url, onDone) =>
      void run(PluginAction.addMarketplace(), () => api.addMarketplace(url), onDone),
    removeMarketplace: (name) =>
      void run(PluginAction.removeMarketplace(name), () => api.removeMarketplace(name)),
    refreshMarketplaces: () => void run(PluginAction.refresh(), () => api.refreshMarketplaces()),
  };
}
