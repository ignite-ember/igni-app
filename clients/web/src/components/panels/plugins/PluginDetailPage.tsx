/** One plugin's page: what it is, what it bundles, and what can be done
 *  to it (install a catalog entry; enable, disable or remove an
 *  installed one). */

import type { InstalledPlugin } from "./installedPlugin";
import type { MarketplacePlugin } from "./marketplace";
import { PluginAction } from "./pluginAction";
import type { ContentsLoad } from "./pluginContents";
import { PluginContentsView } from "./PluginContentsView";
import type { ResolvedPlugin } from "./pluginSelection";

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
  return (
    <div className="plugin-detail">
      <div className="plugin-detail-hero">
        <div className="plugin-detail-title-row">
          {resolved.kind === "installed" && (
            <span className={`plugins-status ${resolved.plugin.enabled ? "is-on" : "is-off"}`} />
          )}
          <h2 className="plugin-detail-title">{about.name}</h2>
          {about.version && <span className="plugins-version">{about.version}</span>}
          {sourceLabel && <span className="plugins-source">{sourceLabel}</span>}
        </div>
        {about.description && <div className="plugin-detail-desc">{about.description}</div>}
        <div className="plugin-detail-actions">
          {resolved.kind === "installed" ? (
            <>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => onToggle(resolved.plugin)}
              >
                {resolved.plugin.enabled ? "Disable" : "Enable"}
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() => onRemove(resolved.plugin)}
              >
                Remove
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => onInstall(resolved.plugin)}
              title={`Install from ${resolved.plugin.source}`}
            >
              {busy ? "Installing…" : "Install"}
            </button>
          )}
        </div>
      </div>

      <PluginContentsView
        contents={contents}
        preview={resolved.kind === "catalog" ? resolved.plugin : null}
      />
    </div>
  );
}
