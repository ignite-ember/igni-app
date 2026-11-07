import { describe, expect, it } from "vitest";

import { InstalledPlugin, InstalledPlugins } from "./installedPlugin";
import { MarketplaceCatalog } from "./marketplace";
import { PluginSelection } from "./pluginSelection";
import { PluginsView } from "./pluginsView";

const quiet = InstalledPlugin.parse({ name: "quiet" })!;

describe("PluginsView", () => {
  it("opens on the marketplace list, with tabs and the catalog toolbar", () => {
    const view = PluginsView.initial();
    expect(view.tab).toBe("marketplace");
    expect(view.showsTabs).toBe(true);
    expect(view.showsCatalogToolbar).toBe(true);
    expect(view.selection).toBeNull();
    expect(view.leaf).toBeNull();
    expect(view.title).toBe("Plugins");
  });

  it("shows the toolbar on the marketplace tab only", () => {
    const view = PluginsView.initial().withTab("installed");
    expect(view.showsTabs).toBe(true);
    expect(view.showsCatalogToolbar).toBe(false);
  });

  it("names an open plugin in the trail, and goes back to the tab it came from", () => {
    const selection = PluginSelection.installed(quiet);
    const open = PluginsView.initial().withTab("installed").open(selection);
    expect(open.selection).toBe(selection);
    expect(open.showsTabs).toBe(false);
    expect(open.leaf).toBe("quiet");
    expect(open.title).toBe("quiet");
    const back = open.back();
    expect(back.tab).toBe("installed");
    expect(back.selection).toBeNull();
    expect(back.showsTabs).toBe(true);
  });

  it("manages marketplaces one level down, never alongside a plugin", () => {
    const markets = PluginsView.initial().open(PluginSelection.installed(quiet)).manageMarkets();
    expect(markets.screen(null).page).toBe("markets");
    expect(markets.selection).toBeNull();
    expect(markets.leaf).toBe("Marketplaces");
    expect(markets.showsCatalogToolbar).toBe(false);
    expect(markets.back().screen(null).page).toBe("catalog");
  });

  it("shows the tab's list on the list", () => {
    expect(PluginsView.initial().screen(null).page).toBe("catalog");
    expect(PluginsView.initial().withTab("installed").screen(null).page).toBe("installed");
  });

  it("always shows a set selection as a plugin's page, from either list", () => {
    const fromInstalled = PluginsView.initial().open(PluginSelection.installed(quiet)).screen(null);
    expect(fromInstalled.page).toBe("detail");
    if (fromInstalled.page !== "detail") return;
    expect(fromInstalled.resolved.kind).toBe("installed");
    expect(fromInstalled.resolved.plugin.name).toBe("quiet");

    const [entry] = MarketplaceCatalog.parse([
      {
        name: "acme",
        url: "u",
        plugins: [{ name: "lint-helper", source: "s2" }],
      },
    ]).entries();
    const view = PluginsView.initial().open(PluginSelection.fromCatalog(entry));
    const preview = view.screen(InstalledPlugins.EMPTY);
    expect(preview.page).toBe("detail");
    if (preview.page !== "detail") return;
    expect(preview.resolved.kind).toBe("catalog");
    const nowInstalled = view.screen(InstalledPlugins.parse([{ name: "lint-helper" }]));
    expect(nowInstalled.page === "detail" && nowInstalled.resolved.kind).toBe("installed");
  });

  it("trails the leaf below the list", () => {
    const list = PluginsView.initial();
    expect(list.crumbs).toEqual([]);
    expect(list.open(PluginSelection.installed(quiet)).crumbs).toEqual(["quiet"]);
    expect(list.manageMarkets().crumbs).toEqual(["Marketplaces"]);
  });

  it("truncates above the leaf to the list, and stays on the leaf itself", () => {
    const open = PluginsView.initial().withTab("installed").open(PluginSelection.installed(quiet));
    expect(open.truncate(-1)).toEqual(open.back());
    expect(open.truncate(0)).toBe(open);
  });
});
