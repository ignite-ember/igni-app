/** The plugins panel's lists and the change it has in flight. */

import { useCallback, useEffect, useState } from "react";
import { InstalledPlugins, type InstalledPlugin } from "./installedPlugin";
import { MarketplaceCatalog, type MarketplacePlugin } from "./marketplace";
import { PluginAction } from "./pluginAction";
import type { PluginsApi } from "./pluginsApi";
import type { ActionResult } from "./pluginWire";

/** Why the last change or read failed. */
export interface PluginsFailure {
  readonly reason: string;
}

export interface PluginsState {
  /** ``null`` until first read. */
  installed: InstalledPlugins | null;
  catalog: MarketplaceCatalog | null;
  /** The last failure, or ``null`` while none stands. */
  error: PluginsFailure | null;
  isRunning: (action: PluginAction) => boolean;
  /** The marketplace refresh is in flight. */
  refreshing: boolean;
  /** An install typed by reference is in flight. */
  installingRef: boolean;
  /** Install a catalog plugin from its own source. */
  installPlugin: (plugin: MarketplacePlugin) => void;
  /** Install from a typed reference; ``onDone`` runs on success. */
  installRef: (ref: string, onDone: () => void) => void;
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
  const [error, setError] = useState<PluginsFailure | null>(null);

  /** Re-read both lists. The installed list's failure is shown; the
   *  catalog's reads as no marketplaces, which the page already explains. */
  const refresh = useCallback(async () => {
    const mine = await api.installed();
    if (mine.ok) {
      setInstalled(mine.value);
    } else {
      setError({ reason: mine.reason });
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
      setError(null);
      const result = await call();
      if (result.ok) {
        onDone?.();
        await refresh();
      } else {
        setError({ reason: result.reason });
      }
      setPending(null);
    },
    [refresh],
  );

  const isRunning = (action: PluginAction) => pending?.is(action) ?? false;

  return {
    installed,
    catalog,
    error,
    isRunning,
    refreshing: isRunning(PluginAction.refresh()),
    installingRef: isRunning(PluginAction.installRef()),
    installPlugin: (plugin) =>
      void run(PluginAction.plugin(plugin.name), () => api.install(plugin.source)),
    installRef: (ref, onDone) =>
      void run(PluginAction.installRef(), () => api.install(ref), onDone),
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
