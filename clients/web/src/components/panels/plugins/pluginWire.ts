/**
 * The wire contract of the plugin RPCs, as the backend declares it
 * (igni-core `PluginInfo`, `MarketplaceInfo`, `PluginContents`,
 * `msg.Info`), and the Results {@link PluginsApi} turns them into.
 *
 * Responses are read through the domain classes' `parse`, never used
 * directly; request arguments are built from these types and nowhere
 * else.
 */

import type { Failure } from "../../../protocol/composerWire";

/** One row of `get_plugin_details`. */
export interface PluginInfoWire {
  name: string;
  description?: string;
  version?: string;
  enabled?: boolean;
  source_root?: string;
  pin?: string;
  has_skills?: boolean;
  has_agents?: boolean;
  has_hooks?: boolean;
  has_mcp?: boolean;
  has_tools?: boolean;
}

/** One plugin inside a marketplace's catalog. */
export interface MarketplacePluginWire {
  name: string;
  source: string;
  description?: string;
  version?: string;
  branch?: string;
}

/** One row of `get_marketplaces`. */
export interface MarketplaceInfoWire {
  name?: string;
  url: string;
  last_fetched?: string;
  plugins?: MarketplacePluginWire[];
}

/** `get_plugin_contents` and `preview_plugin`. `error` is set, and the
 *  lists left empty, when the backend could not read the plugin. */
export interface PluginContentsWire {
  name: string;
  root_path: string;
  skills: { name: string; description?: string }[];
  agents: { name: string; description?: string }[];
  hooks: { event: string; count: number }[];
  mcp_servers: { name: string; transport: string; command: string }[];
  tools: { name: string }[];
  readme: string;
  error?: string;
}

/** The free-text answer of a mutation (`msg.Info`). */
export interface InfoReplyWire {
  text?: string;
}

export type InstallPluginArgs = { ref: string };
export type SetPluginEnabledArgs = { name: string; enabled: boolean };
export type PluginNameArgs = { name: string };
export type AddMarketplaceArgs = { url: string };
export type MarketplaceNameArgs = { name: string };
/** `name: null` refreshes every marketplace. */
export type RefreshMarketplacesArgs = { name: string | null };
export type PreviewPluginArgs = { source: string; branch: string | null; subdir: null };

export type PluginsResult<T> = { ok: true; value: T } | Failure;

export type ActionResult = { ok: true } | Failure;
