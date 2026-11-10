/** Where the plugins panel is: a list tab, a plugin's page, or the
 *  marketplace management page. */

import type { InstalledPlugins } from "./installedPlugin";
import type { PluginSelection, ResolvedPlugin } from "./pluginSelection";

export type Tab = "installed" | "marketplace";

/** The screen the panel shows: a plugin's page carries the plugin as it
 *  reads once merged with what is installed; a list shows one tab. */
export type PluginsScreen =
  | { page: "detail"; resolved: ResolvedPlugin }
  | { page: "markets" }
  | { page: "installed" }
  | { page: "catalog" };

type Page =
  | { page: "list" }
  | { page: "detail"; selection: PluginSelection }
  | { page: "markets" };

const LIST: Page = { page: "list" };

/**
 * Immutable: every move returns a new view. The tab is kept while a
 * plugin's page or the marketplaces page is open, so going back lands
 * on the tab that was showing.
 */
export class PluginsView {
  private constructor(
    readonly tab: Tab,
    private readonly at: Page,
  ) {}

  /** The panel opens on the marketplace catalog. */
  static initial(): PluginsView {
    return new PluginsView("marketplace", LIST);
  }

  withTab(tab: Tab): PluginsView {
    return new PluginsView(tab, LIST);
  }

  open(selection: PluginSelection): PluginsView {
    return new PluginsView(this.tab, { page: "detail", selection });
  }

  manageMarkets(): PluginsView {
    return new PluginsView(this.tab, { page: "markets" });
  }

  /** Every page is one level below the list. */
  back(): PluginsView {
    return new PluginsView(this.tab, LIST);
  }

  /**
   * Move to the crumb at ``index``. The panel is one level deep, so a
   * negative index (the list, or above it) goes back and any other index
   * is the leaf itself, already showing. That holds only at this depth:
   * a deeper panel must map each index to its own level.
   */
  truncate(index: number): PluginsView {
    return index < 0 ? this.back() : this;
  }

  get selection(): PluginSelection | null {
    return this.at.page === "detail" ? this.at.selection : null;
  }

  /** Which screen shows, given what is installed. */
  screen(installed: InstalledPlugins | null): PluginsScreen {
    const at = this.at;
    if (at.page === "detail") return { page: "detail", resolved: at.selection.resolve(installed) };
    if (at.page === "markets") return { page: "markets" };
    return { page: this.tab === "installed" ? "installed" : "catalog" };
  }

  /** The tabs show on the list only; below it the page trail leads back. */
  get showsTabs(): boolean {
    return this.at.page === "list";
  }

  get showsCatalogToolbar(): boolean {
    return this.at.page === "list" && this.tab === "marketplace";
  }

  /** The crumb below the list, or ``null`` on the list itself. */
  get leaf(): string | null {
    if (this.at.page === "detail") return this.at.selection.name || "Plugin";
    if (this.at.page === "markets") return "Marketplaces";
    return null;
  }

  /** The trail below the list: empty on the list itself. */
  get crumbs(): string[] {
    return this.leaf === null ? [] : [this.leaf];
  }

  get title(): string {
    return this.leaf ?? "Plugins";
  }
}
