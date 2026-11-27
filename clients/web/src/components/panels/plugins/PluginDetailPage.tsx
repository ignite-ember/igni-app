/** One plugin's page: what it is, what it bundles, and what can be done
 *  to it (install a catalog entry; enable, disable or remove an
 *  installed one). */

import { Button } from "../../page/Button";
import { EntityHero } from "../../page/EntityHero";
import { HeroChip } from "../../page/HeroChip";
import type { InstalledPlugin } from "./installedPlugin";
import type { MarketplacePlugin } from "./marketplace";
import { PluginAction } from "./pluginAction";
import type { ContentsLoad } from "./pluginContents";
import { PluginContentsView } from "./PluginContentsView";
import type { ResolvedPlugin } from "./pluginSelection";

/** The one-line capability summary shown under the title: "3 agents ·
 *  1 MCP server · 2 hooks", built from whatever the contents loaded. */
function capabilitySummary(contents: ContentsLoad): string[] {
  if (contents.kind !== "loaded") return [];
  const { agents, mcpServers, hooks, tools } = contents.contents.parts;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return [
    agents.length > 0 ? plural(agents.length, "agent") : "",
    mcpServers.length > 0 ? plural(mcpServers.length, "MCP server") : "",
    hooks.length > 0 ? plural(hooks.length, "hook") : "",
    tools.length > 0 ? plural(tools.length, "tool") : "",
  ].filter(Boolean);
}

export function PluginDetailPage({
  resolved,
  contents,
  isRunning,
  onInstall,
  onToggle,
  onRemove,
}: {
  resolved: ResolvedPlugin;
  contents: ContentsLoad;
  isRunning: (action: PluginAction) => boolean;
  onInstall: (plugin: MarketplacePlugin) => void;
  onToggle: (plugin: InstalledPlugin) => void;
  onRemove: (plugin: InstalledPlugin) => void;
}) {
  const { about, sourceLabel } = resolved.display;
  const busy = isRunning(PluginAction.plugin(about.name));
  const caps = capabilitySummary(contents);
  return (
    <div className="entity-detail">
      <EntityHero
        name={about.name}
        leading={
          resolved.kind === "installed" && (
            <span className={`plugins-status ${resolved.plugin.enabled ? "is-on" : "is-off"}`} />
          )
        }
        meta={
          <>
            {about.version && <span className="entity-meta">{about.version}</span>}
            {sourceLabel && <span className="entity-meta">{sourceLabel}</span>}
          </>
        }
        description={about.description}
        chips={
          caps.length > 0 &&
          caps.map((c) => <HeroChip key={c}>{c}</HeroChip>)
        }
        actions={
          resolved.kind === "installed" ? (
            <>
              <Button disabled={busy} onClick={() => onToggle(resolved.plugin)}>
                {resolved.plugin.enabled ? "Disable" : "Enable"}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => onRemove(resolved.plugin)}>
                Remove
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              busy={busy}
              onClick={() => onInstall(resolved.plugin)}
              title={`Install from ${resolved.plugin.source}`}
            >
              {busy ? "Installing…" : "Install"}
            </Button>
          )
        }
      />

      <PluginContentsView
        contents={contents}
        preview={resolved.kind === "catalog" ? resolved.plugin : null}
      />
    </div>
  );
}
