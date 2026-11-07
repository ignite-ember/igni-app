/** The plugin a detail page is about, and how it reads once merged with
 *  what is installed. */

import type { InstalledPlugin, InstalledPlugins } from "./installedPlugin";
import type { CatalogEntry, MarketplacePlugin } from "./marketplace";
import type { PluginAbout } from "./pluginAbout";

/** What the page's header shows. */
export interface PluginDisplay {
  about: PluginAbout;
  sourceLabel: string;
}

/** A plugin the page treats as installed, or a catalog entry it can
 *  only preview and install. */
export type ResolvedPlugin =
  | { kind: "installed"; plugin: InstalledPlugin; display: PluginDisplay }
  | { kind: "catalog"; plugin: MarketplacePlugin; market: string; display: PluginDisplay };

type Origin =
  | { kind: "installed"; plugin: InstalledPlugin }
  | { kind: "catalog"; entry: CatalogEntry };

export class PluginSelection {
  private constructor(private readonly origin: Origin) {}

  static installed(plugin: InstalledPlugin): PluginSelection {
    return new PluginSelection({ kind: "installed", plugin });
  }

  static fromCatalog(entry: CatalogEntry): PluginSelection {
    return new PluginSelection({ kind: "catalog", entry });
  }

  get name(): string {
    const origin = this.origin;
    return origin.kind === "installed" ? origin.plugin.name : origin.entry.plugin.name;
  }

  /**
   * The page reads the same whichever list it was opened from: a plugin
   * that is installed shows as installed, with the installed row's fields
   * winning and the catalog's filling what it leaves empty. A plugin
   * opened from the Installed tab stays installed even before the list
   * has been re-read.
   */
  resolve(installed: InstalledPlugins | null): ResolvedPlugin {
    const origin = this.origin;
    if (origin.kind === "installed") {
      const row = installed?.find(origin.plugin.name) ?? origin.plugin;
      return PluginSelection.asInstalled(row, origin.plugin.about, "");
    }
    const { market, plugin } = origin.entry;
    const row = installed?.find(plugin.name);
    if (row) return PluginSelection.asInstalled(row, plugin.about, market);
    const display = { about: plugin.about, sourceLabel: market };
    return { kind: "catalog", plugin, market, display };
  }

  private static asInstalled(
    row: InstalledPlugin,
    fallback: PluginAbout,
    market: string,
  ): ResolvedPlugin {
    return {
      kind: "installed",
      plugin: row,
      display: { about: row.about.or(fallback), sourceLabel: row.sourceRoot || market },
    };
  }
}
