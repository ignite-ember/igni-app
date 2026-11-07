import { describe, expect, it } from "vitest";

import { Marketplace, MarketplaceCatalog } from "./marketplace";

const RAW = [
  {
    name: "acme",
    url: "https://github.com/acme/market",
    last_fetched: "2026-11-01",
    plugins: [
      { name: "commit-tools", source: "https://github.com/acme/commit-tools.git" },
      { name: "lint-helper", source: "https://x/plugins.git [lint]", description: "Runs the linter" },
      { source: "nameless" },
    ],
  },
  { url: "https://git.example/unnamed", plugins: [{ name: "ssh-only", source: "git@host:x.git" }] },
];

describe("MarketplaceCatalog", () => {
  const catalog = MarketplaceCatalog.parse(RAW);

  it("counts marketplaces and the plugins that parse", () => {
    expect(catalog.marketCount).toBe(2);
    expect(catalog.pluginCount).toBe(3);
  });

  it("reads anything that is not a list as no marketplaces", () => {
    expect(MarketplaceCatalog.parse(null).marketCount).toBe(0);
    expect(MarketplaceCatalog.parse({ plugins: [] }).pluginCount).toBe(0);
  });

  it("flattens entries under each marketplace's display name", () => {
    expect(catalog.entries().map((e) => `${e.market}/${e.plugin.name}`)).toEqual([
      "acme/commit-tools",
      "acme/lint-helper",
      "https://git.example/unnamed/ssh-only",
    ]);
  });

  it("filters by name, description or source, ignoring case and blanks", () => {
    const names = (q: string) => catalog.filter(q).map((e) => e.plugin.name);
    expect(names("  ")).toHaveLength(3);
    expect(names("COMMIT")).toEqual(["commit-tools"]);
    expect(names("linter")).toEqual(["lint-helper"]);
    expect(names("git@host")).toEqual(["ssh-only"]);
    expect(names("zzz")).toEqual([]);
  });
});

describe("Marketplace", () => {
  it("is named by its name, removable by it, and labelled by its URL without one", () => {
    const [named, unnamed] = MarketplaceCatalog.parse(RAW).markets;
    expect(named.displayName).toBe("acme");
    expect(named.removableName).toBe("acme");
    expect(named.lastFetched).toBe("2026-11-01");
    expect(unnamed.displayName).toBe("https://git.example/unnamed");
    expect(unnamed.removableName).toBeNull();
  });

  it("has no plugins when the field is missing", () => {
    expect(Marketplace.parse({ name: "x", url: "u" }).pluginCount).toBe(0);
  });
});
