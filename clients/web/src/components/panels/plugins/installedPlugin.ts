/** The plugins installed in this project, as `get_plugin_details` lists them. */

import { WirePayload } from "../../../protocol/wirePayload";
import { PluginAbout } from "./pluginAbout";

/** Each `has_*` flag and the chip it shows as, in display order. */
const CAPABILITY_FLAGS = [
  ["has_skills", "skills"],
  ["has_agents", "agents"],
  ["has_hooks", "hooks"],
  ["has_mcp", "mcp"],
  ["has_tools", "tools"],
] as const;

export class InstalledPlugin {
  constructor(
    readonly about: PluginAbout,
    readonly enabled: boolean,
    readonly sourceRoot: string,
    readonly pin: string,
    readonly capabilities: readonly string[],
  ) {}

  /** One row, or ``null`` when it has no name to address it by. */
  static parse(raw: unknown): InstalledPlugin | null {
    const p = new WirePayload(raw);
    const about = PluginAbout.read(p);
    if (!about.name) return null;
    return new InstalledPlugin(
      about,
      p.flag("enabled"),
      p.string("source_root"),
      p.string("pin"),
      CAPABILITY_FLAGS.filter(([flag]) => p.flag(flag)).map(([, chip]) => chip),
    );
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

  /** The pinned ref, abbreviated as a commit is. */
  get shortPin(): string {
    return this.pin.slice(0, 8);
  }
}

export class InstalledPlugins {
  static readonly EMPTY = new InstalledPlugins([]);

  constructor(readonly rows: readonly InstalledPlugin[]) {}

  /** Every row that parses; anything that is not a list is empty. */
  static parse(raw: unknown): InstalledPlugins {
    if (!Array.isArray(raw)) return InstalledPlugins.EMPTY;
    const rows: InstalledPlugin[] = [];
    for (const r of raw) {
      const plugin = InstalledPlugin.parse(r);
      if (plugin) rows.push(plugin);
    }
    return new InstalledPlugins(rows);
  }

  get count(): number {
    return this.rows.length;
  }

  find(name: string): InstalledPlugin | undefined {
    return this.rows.find((p) => p.name === name);
  }

  has(name: string): boolean {
    return this.find(name) !== undefined;
  }
}
