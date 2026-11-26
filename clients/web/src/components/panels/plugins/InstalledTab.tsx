/** The Installed tab: install from a git ref, and the installed plugins. */

import { CardGrid } from "../../page/CardGrid";
import { CardGridSkeleton } from "../../page/CardGridSkeleton";
import { EntityCard } from "../../page/EntityCard";
import { PageEmpty } from "../../page/PageEmpty";
import type { InstalledPlugin, InstalledPlugins } from "./installedPlugin";
import { PluginCapabilities } from "./PluginParts";

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
  if (installed === null) return <CardGridSkeleton />;
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
        <PageEmpty
          title="No plugins installed yet"
          hint="Open the Marketplace tab to browse and install plugins, or paste a git URL above."
        />
      ) : (
        <CardGrid flow>
          {installed.rows.map((p) => (
            <EntityCard
              key={p.name}
              glyph={p.name}
              name={
                <>
                  <span className={`plugins-status ${p.enabled ? "is-on" : "is-off"}`} /> {p.name}
                  {p.version && <span className="meta"> · {p.version}</span>}
                </>
              }
              label={p.name}
              onOpen={() => onOpen(p)}
              action={
                <span className="plugins-chevron-end" aria-hidden="true">
                  ›
                </span>
              }
              description={p.description}
              chips={<PluginCapabilities plugin={p} />}
              footer={
                (p.sourceRoot || !p.enabled) && (
                  <>
                    {!p.enabled && <span className="plugins-cat-chip">disabled</span>}
                    {p.sourceRoot && <span className="plugins-source">{p.sourceRoot}</span>}
                  </>
                )
              }
            />
          ))}
        </CardGrid>
      )}
    </>
  );
}
