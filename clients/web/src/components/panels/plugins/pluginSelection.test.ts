import { describe, expect, it } from "vitest";

import { InstalledPlugins } from "./installedPlugin";
import { MarketplaceCatalog } from "./marketplace";
import { PluginSelection } from "./pluginSelection";

const INSTALLED = InstalledPlugins.parse([
  { name: "commit-tools", version: "1.2.0", enabled: true, source_root: "acme" },
]);
const [installedEntry, catalogEntry] = MarketplaceCatalog.parse([
  {
    name: "acme",
    url: "u",
    plugins: [
      { name: "commit-tools", source: "s1", description: "Write better commits", version: "9" },
      { name: "lint-helper", source: "s2", version: "0.3.0", branch: "stable" },
    ],
  },
]).entries();

describe("PluginSelection.resolve", () => {
  it("treats a catalog entry that is installed as installed, the installed row winning", () => {
    const r = PluginSelection.fromCatalog(installedEntry).resolve(INSTALLED);
    expect(r.kind).toBe("installed");
    expect(r.display.about.version).toBe("1.2.0");
    // What the installed row leaves empty, the catalog fills.
    expect(r.display.about.description).toBe("Write better commits");
    expect(r.display.sourceLabel).toBe("acme");
  });

  it("keeps a catalog entry that is not installed as a preview of its source", () => {
    const r = PluginSelection.fromCatalog(catalogEntry).resolve(INSTALLED);
    expect(r.kind).toBe("catalog");
    if (r.kind !== "catalog") return;
    expect(r.plugin.source).toBe("s2");
    expect(r.plugin.branch).toBe("stable");
    expect(r.market).toBe("acme");
    expect(r.display.sourceLabel).toBe("acme");
  });

  it("keeps a plugin opened from the Installed tab installed before the list is read", () => {
    const own = INSTALLED.rows[0];
    const selection = PluginSelection.installed(own);
    expect(selection.name).toBe("commit-tools");
    const r = selection.resolve(null);
    expect(r.kind).toBe("installed");
    expect(r.plugin).toBe(own);
  });
});
