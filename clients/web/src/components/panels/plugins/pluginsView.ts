/** Where the plugins panel is: a list tab, a plugin's page, or the
 *  marketplace management page. */

import type { PluginSelection } from "./pluginSelection";

export type Tab = "installed" | "marketplace";

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

  get selection(): PluginSelection | null {
    return this.at.page === "detail" ? this.at.selection : null;
  }

  get isMarkets(): boolean {
    return this.at.page === "markets";
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

  get title(): string {
    return this.leaf ?? "Plugins";
  }
}
