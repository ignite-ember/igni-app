/** What a plugin bundles: `get_plugin_contents` for an installed copy,
 *  `preview_plugin` for a catalog entry. */

import { WirePayload } from "../../../protocol/wirePayload";

export interface NamedEntry {
  name: string;
  description: string;
}

export interface HookEntry {
  event: string;
  count: number;
}

export interface McpServerEntry {
  name: string;
  transport: string;
  command: string;
}

/** The parts a plugin can bundle, each listed by name. */
export interface BundledParts {
  skills: NamedEntry[];
  agents: NamedEntry[];
  hooks: HookEntry[];
  mcpServers: McpServerEntry[];
  tools: NamedEntry[];
}

export class PluginContents {
  constructor(
    readonly rootPath: string,
    readonly readme: string,
    readonly parts: BundledParts,
  ) {}

  /** A successful answer's body. The in-band ``error`` is read by
   *  {@link PluginsApi}, which turns it into a Failure. */
  static parse(raw: unknown): PluginContents {
    const p = new WirePayload(raw);
    const rows = (key: string) => p.list(key).map((r) => new WirePayload(r));
    const named = (key: string) =>
      rows(key).map((r) => ({ name: r.text("name"), description: r.string("description") }));
    return new PluginContents(p.string("root_path"), p.string("readme"), {
      skills: named("skills"),
      agents: named("agents"),
      hooks: rows("hooks").map((r) => ({ event: r.text("event"), count: r.number("count") })),
      mcpServers: rows("mcp_servers").map((r) => ({
        name: r.text("name"),
        transport: r.text("transport"),
        command: r.string("command"),
      })),
      tools: named("tools"),
    });
  }

  /** Bundles no part and has no README. */
  get isEmpty(): boolean {
    const { skills, agents, hooks, mcpServers, tools } = this.parts;
    return (
      skills.length === 0 &&
      agents.length === 0 &&
      hooks.length === 0 &&
      mcpServers.length === 0 &&
      tools.length === 0 &&
      !this.readme
    );
  }
}

/** The detail page's contents: one phase rather than a loading flag
 *  beside a value. */
export type ContentsLoad =
  | { kind: "loading" }
  | { kind: "loaded"; contents: PluginContents }
  | { kind: "failed"; reason: string };
