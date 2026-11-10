/** The Installed tab: install from a git ref, and the installed plugins. */

import type { InstalledPlugin, InstalledPlugins } from "./installedPlugin";
import { PluginCapabilities, PluginsSkeleton } from "./PluginParts";

export function InstalledTab({
  installed,
  installRef,
  onInstallRefChange,
  installing,
  onInstall,
  onOpen,
}: {
  installed: InstalledPlugins | null;
  installRef: string;
  onInstallRefChange: (ref: string) => void;
  installing: boolean;
  onInstall: (ref: string) => void;
  onOpen: (plugin: InstalledPlugin) => void;
}) {
  if (installed === null) return <PluginsSkeleton />;
  return (
    <>
      <div className="plugins-install-row">
        <input
          className="panel-input"
          placeholder="Install from URL: github.com/owner/repo or git URL…"
          value={installRef}
          onChange={(e) => onInstallRefChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && installRef.trim() && onInstall(installRef.trim())}
        />
        <button
          className="btn btn-sm btn-primary"
          disabled={!installRef.trim() || installing}
          onClick={() => onInstall(installRef.trim())}
        >
          {installing ? "…" : "Install"}
        </button>
      </div>
      {installed.count === 0 ? (
        <div className="plugins-empty">
          <div className="plugins-empty-title">No plugins installed yet</div>
          <div className="plugins-empty-hint">
            Open the Marketplace tab to browse and install plugins, or paste a git URL above.
          </div>
        </div>
      ) : (
        <div className="plugins-list">
          {installed.rows.map((p) => (
            <div
              className="plugins-card plugins-card-clickable"
              key={p.name}
              onClick={() => onOpen(p)}
            >
              <div className="plugins-card-head">
                <div className="plugins-card-title">
                  <span className={`plugins-status ${p.enabled ? "is-on" : "is-off"}`} />
                  <span className="plugins-name">{p.name}</span>
                  {p.version && <span className="plugins-version">{p.version}</span>}
                  {p.sourceRoot && <span className="plugins-source">{p.sourceRoot}</span>}
                </div>
                <span className="plugins-chevron-end">›</span>
              </div>
              {p.description && <div className="plugins-desc">{p.description}</div>}
              <PluginCapabilities plugin={p} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
