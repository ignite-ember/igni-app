/** The Installed tab: install from a git ref, and the installed plugins. */

import { EntityGlyph } from "../../EntityGlyph";
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
        <div className="plugins-grid plugins-grid--even">
          {installed.rows.map((p) => (
            <div
              className="plugins-gcard"
              key={p.name}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(p)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(p);
                }
              }}
            >
              <span className="plugins-gcard-icon" aria-hidden="true">
                <EntityGlyph name={p.name} size={38} />
              </span>
              <div className="plugins-gcard-body">
                <div className="plugins-gcard-top">
                  <span className="plugins-name">
                    <span className={`plugins-status ${p.enabled ? "is-on" : "is-off"}`} /> {p.name}
                    {p.version && <span className="meta"> · {p.version}</span>}
                  </span>
                  <span className="plugins-chevron-end" aria-hidden="true">
                    ›
                  </span>
                </div>
                {p.description && <p className="plugins-gcard-desc">{p.description}</p>}
                <PluginCapabilities plugin={p} />
                {(p.sourceRoot || !p.enabled) && (
                  <div className="plugins-gcard-foot">
                    {!p.enabled && <span className="plugins-cat-chip">disabled</span>}
                    {p.sourceRoot && <span className="plugins-source">{p.sourceRoot}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
