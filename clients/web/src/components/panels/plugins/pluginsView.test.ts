import { describe, expect, it } from "vitest";

import { InstalledPlugin } from "./installedPlugin";
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
    expect(markets.isMarkets).toBe(true);
    expect(markets.selection).toBeNull();
    expect(markets.leaf).toBe("Marketplaces");
    expect(markets.showsCatalogToolbar).toBe(false);
    expect(markets.back().isMarkets).toBe(false);
  });
});
