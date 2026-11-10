/**
 * The plugins panel's page bodies, one per screen. The renderer table is
 * typed over every ``PluginsScreen`` page, so a new page does not compile
 * until it has a renderer. Each row wires its page to the plugin state,
 * and clears the field it owns once the change it started succeeds.
 */

import type { ComponentType } from "react";

import { InstalledPlugins } from "./installedPlugin";
import { InstalledTab } from "./InstalledTab";
import { MarketplacesPage } from "./MarketplacesPage";
import { MarketplaceTab } from "./MarketplaceTab";
import type { ContentsLoad } from "./pluginContents";
import { PluginDetailPage } from "./PluginDetailPage";
import { PluginSelection } from "./pluginSelection";
import type { PluginsScreen, PluginsView } from "./pluginsView";
import type { PluginsState } from "./usePlugins";

/** One text field the panel holds while it is typed. */
export interface PluginsField {
  value: string;
  set: (value: string) => void;
}

/** What is being typed: an install reference, a marketplace URL, a search. */
export interface PluginsFields {
  installRef: PluginsField;
  marketUrl: PluginsField;
  query: PluginsField;
}

/** What every page reads and how it moves the panel. */
export interface PluginsPageContext {
  plugins: PluginsState;
  contents: ContentsLoad;
  fields: PluginsFields;
  /** Move the panel: every move is a ``PluginsView`` method. */
  go: (move: (view: PluginsView) => PluginsView) => void;
}

export interface PluginsPageProps<P extends PluginsScreen["page"]> {
  screen: Extract<PluginsScreen, { page: P }>;
  ctx: PluginsPageContext;
}

type PluginsPageRenderers = {
  [P in PluginsScreen["page"]]: ComponentType<PluginsPageProps<P>>;
};

const PLUGINS_PAGE_RENDERERS: PluginsPageRenderers = {
  detail: ({ screen, ctx }) => (
    <PluginDetailPage
      resolved={screen.resolved}
      contents={ctx.contents}
      isRunning={ctx.plugins.isRunning}
      onInstall={ctx.plugins.installPlugin}
      onToggle={ctx.plugins.toggle}
      onRemove={(p) => ctx.plugins.remove(p, () => ctx.go((v) => v.back()))}
    />
  ),
  markets: ({ ctx }) => (
    <MarketplacesPage
      catalog={ctx.plugins.catalog}
      marketUrl={ctx.fields.marketUrl.value}
      onMarketUrlChange={ctx.fields.marketUrl.set}
      isRunning={ctx.plugins.isRunning}
      onAddMarketplace={(url) =>
        ctx.plugins.addMarketplace(url, () => ctx.fields.marketUrl.set(""))
      }
      onRemoveMarketplace={ctx.plugins.removeMarketplace}
      onRefresh={ctx.plugins.refreshMarketplaces}
    />
  ),
  installed: ({ ctx }) => (
    <InstalledTab
      installed={ctx.plugins.installed}
      installRef={ctx.fields.installRef.value}
      onInstallRefChange={ctx.fields.installRef.set}
      installing={ctx.plugins.installingRef}
      onInstall={(ref) => ctx.plugins.installRef(ref, () => ctx.fields.installRef.set(""))}
      onOpen={(p) => ctx.go((v) => v.open(PluginSelection.installed(p)))}
    />
  ),
  catalog: ({ ctx }) => (
    <MarketplaceTab
      catalog={ctx.plugins.catalog}
      entries={ctx.plugins.catalog?.filter(ctx.fields.query.value) ?? []}
      installed={ctx.plugins.installed ?? InstalledPlugins.EMPTY}
      isRunning={ctx.plugins.isRunning}
      onInstall={ctx.plugins.installPlugin}
      onOpen={(entry) => ctx.go((v) => v.open(PluginSelection.fromCatalog(entry)))}
    />
  ),
};

function rendererFor<P extends PluginsScreen["page"]>(page: P): ComponentType<PluginsPageProps<P>> {
  return PLUGINS_PAGE_RENDERERS[page];
}

export function PluginsPage({ screen, ctx }: PluginsPageProps<PluginsScreen["page"]>) {
  const Render = rendererFor(screen.page);
  return <Render screen={screen} ctx={ctx} />;
}
