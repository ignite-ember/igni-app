/**
 * The plugin RPCs. The only place their method names and argument
 * shapes are written; every expected failure comes back as a Failure
 * carrying the reason, never as a rejection.
 */

import type { IgniClient } from "../../../protocol/client";
import { failureReason } from "../../../protocol/composerWire";
import { WirePayload } from "../../../protocol/wirePayload";
import { InstalledPlugins } from "./installedPlugin";
import { MarketplaceCatalog } from "./marketplace";
import { PluginContents } from "./pluginContents";
import type {
  ActionResult,
  AddMarketplaceArgs,
  InfoReplyWire,
  InstallPluginArgs,
  MarketplaceInfoWire,
  MarketplaceNameArgs,
  PluginContentsWire,
  PluginInfoWire,
  PluginNameArgs,
  PluginsResult,
  PreviewPluginArgs,
  RefreshMarketplacesArgs,
  SetPluginEnabledArgs,
} from "./pluginWire";

/**
 * `add_marketplace` answers a failure as free text (igni-core
 * `marketplace_controller.add` returns `msg.Info`), so these prefixes
 * are how one is told apart from success. Confined to
 * {@link PluginsApi.addMarketplace}.
 */
const ADD_MARKETPLACE_FAILED = /^(Failed|git error)/i;

export class PluginsApi {
  constructor(private readonly client: Pick<IgniClient, "rpc">) {}

  async installed(): Promise<PluginsResult<InstalledPlugins>> {
    try {
      const rows = await this.client.rpc<PluginInfoWire[]>("get_plugin_details");
      return { ok: true, value: InstalledPlugins.parse(rows) };
    } catch (e) {
      return { ok: false, reason: failureReason(e) };
    }
  }

  async catalog(): Promise<PluginsResult<MarketplaceCatalog>> {
    try {
      const rows = await this.client.rpc<MarketplaceInfoWire[]>("get_marketplaces");
      return { ok: true, value: MarketplaceCatalog.parse(rows) };
    } catch (e) {
      return { ok: false, reason: failureReason(e) };
    }
  }

  install(ref: string): Promise<ActionResult> {
    const args: InstallPluginArgs = { ref };
    return this.perform("install_plugin", args);
  }

  setEnabled(name: string, enabled: boolean): Promise<ActionResult> {
    const args: SetPluginEnabledArgs = { name, enabled };
    return this.perform("set_plugin_enabled", args);
  }

  remove(name: string): Promise<ActionResult> {
    const args: PluginNameArgs = { name };
    return this.perform("remove_plugin", args);
  }

  async addMarketplace(url: string): Promise<ActionResult> {
    const args: AddMarketplaceArgs = { url };
    try {
      const reply = await this.client.rpc<InfoReplyWire>("add_marketplace", args);
      const text = new WirePayload(reply).string("text");
      return ADD_MARKETPLACE_FAILED.test(text) ? { ok: false, reason: text } : { ok: true };
    } catch (e) {
      return { ok: false, reason: failureReason(e) };
    }
  }

  removeMarketplace(name: string): Promise<ActionResult> {
    const args: MarketplaceNameArgs = { name };
    return this.perform("remove_marketplace", args);
  }

  /** ``null`` re-fetches every marketplace's catalog. */
  refreshMarketplaces(name: string | null = null): Promise<ActionResult> {
    const args: RefreshMarketplacesArgs = { name };
    return this.perform("refresh_marketplaces", args);
  }

  /** An installed plugin's own copy. */
  contents(name: string): Promise<PluginsResult<PluginContents>> {
    const args: PluginNameArgs = { name };
    return this.readContents("get_plugin_contents", args);
  }

  /** A catalog plugin, read from its source without installing it. */
  preview(source: string, branch: string | null): Promise<PluginsResult<PluginContents>> {
    const args: PreviewPluginArgs = { source, branch, subdir: null };
    return this.readContents("preview_plugin", args);
  }

  private async perform(method: string, args: Record<string, unknown>): Promise<ActionResult> {
    try {
      await this.client.rpc(method, args);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: failureReason(e) };
    }
  }

  /** The backend reports an unreadable plugin in-band, as ``error``;
   *  that and a rejected call are the same Failure here. */
  private async readContents(
    method: string,
    args: Record<string, unknown>,
  ): Promise<PluginsResult<PluginContents>> {
    try {
      const raw = await this.client.rpc<PluginContentsWire>(method, args);
      const error = new WirePayload(raw).string("error");
      return error ? { ok: false, reason: error } : { ok: true, value: PluginContents.parse(raw) };
    } catch (e) {
      return { ok: false, reason: failureReason(e) };
    }
  }
}
