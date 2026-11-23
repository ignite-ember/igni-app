/** The registered marketplaces and the catalog they add up to, as
 *  `get_marketplaces` lists them. */

import { WirePayload } from "../../../protocol/wirePayload";
import { PluginAbout } from "./pluginAbout";

/** One plugin a marketplace offers. ``source`` is where it lives, as
 *  the catalog displays it (``url [subdir]``); ``branch`` is empty when
 *  the catalog names none; ``market`` is the offering marketplace's
 *  name, empty when it has none. */
export class MarketplacePlugin {
  constructor(
    readonly about: PluginAbout,
    readonly source: string,
    readonly branch: string,
    readonly market: string = "",
    readonly category: string = "",
  ) {}

  /** One catalog entry, or ``null`` when it has no name. */
  static parse(raw: unknown, market = ""): MarketplacePlugin | null {
    const p = new WirePayload(raw);
    const about = PluginAbout.read(p);
    if (!about.name) return null;
    return new MarketplacePlugin(
      about,
      p.string("source"),
      p.string("branch"),
      market,
      p.string("category"),
    );
  }

  /** What `install_plugin` takes for it: ``@<marketplace>/<plugin>``,
   *  which the backend resolves to the source's URL, subdir and branch.
   *  ``source`` is a display string, not a git URL, so it is only the
   *  fallback for a marketplace without a name. */
  get installRef(): string {
    return this.market ? `@${this.market}/${this.name}` : this.source;
  }

  get name(): string {
    return this.about.name;
  }

  get description(): string {
    return this.about.description;
  }

  get version(): string {
    return this.about.version;
  }

  /** Whether a lower-cased search term appears in the name, the
   *  description or the source. */
  matches(term: string): boolean {
    return [this.name, this.description, this.source].some((field) =>
      field.toLowerCase().includes(term),
    );
  }
}

export class Marketplace {
  constructor(
    readonly name: string,
    readonly url: string,
    readonly lastFetched: string,
    readonly plugins: readonly MarketplacePlugin[],
  ) {}

  static parse(raw: unknown): Marketplace {
    const p = new WirePayload(raw);
    const name = p.string("name");
    const plugins: MarketplacePlugin[] = [];
    for (const entry of p.list("plugins")) {
      const plugin = MarketplacePlugin.parse(entry, name);
      if (plugin) plugins.push(plugin);
    }
    return new Marketplace(name, p.string("url"), p.string("last_fetched"), plugins);
  }

  /** An unnamed marketplace is labelled by its URL. */
  get displayName(): string {
    return this.name || this.url;
  }

  /** The name to unregister it by; ``null`` when it has none, since
   *  removal is by name. */
  get removableName(): string | null {
    return this.name || null;
  }

  get pluginCount(): number {
    return this.plugins.length;
  }
}

/** A catalog plugin and the marketplace (by display name) offering it. */
export interface CatalogEntry {
  market: string;
  plugin: MarketplacePlugin;
}

export class MarketplaceCatalog {
  static readonly EMPTY = new MarketplaceCatalog([]);

  constructor(readonly markets: readonly Marketplace[]) {}

  /** Anything that is not a list is no marketplaces at all. */
  static parse(raw: unknown): MarketplaceCatalog {
    if (!Array.isArray(raw)) return MarketplaceCatalog.EMPTY;
    return new MarketplaceCatalog(raw.map((m) => Marketplace.parse(m)));
  }

  get marketCount(): number {
    return this.markets.length;
  }

  get pluginCount(): number {
    return this.markets.reduce((n, m) => n + m.pluginCount, 0);
  }

  /** Every marketplace's plugins, flattened in marketplace order. */
  entries(): CatalogEntry[] {
    return this.markets.flatMap((m) =>
      m.plugins.map((plugin) => ({ market: m.displayName, plugin })),
    );
  }

  /** The entries a search matches; a blank search matches all. */
  filter(query: string): CatalogEntry[] {
    const term = query.trim().toLowerCase();
    const all = this.entries();
    return term ? all.filter(({ plugin }) => plugin.matches(term)) : all;
  }
}
