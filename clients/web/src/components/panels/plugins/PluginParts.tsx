/** Small pieces the plugins page repeats: a source link, a plugin's
 *  capability chips, and the contents' loading placeholder. */

import { Skeleton } from "@ignite-ember/ui-react";
import type { InstalledPlugin } from "./installedPlugin";
import { SourceRef } from "./sourceRef";

/** A catalog source as a link (when it is http) plus a subdirectory chip. */
export function SourceLink({ raw }: { raw: string }) {
  const ref = SourceRef.parse(raw);
  return (
    <span className="plugins-source-link">
      {ref.isHttp ? (
        <a href={ref.url} target="_blank" rel="noreferrer">
          {ref.displayUrl}
        </a>
      ) : (
        <code>{ref.displayUrl}</code>
      )}
      {ref.subdir && <span className="plugins-source-subdir">{ref.subdir}</span>}
    </span>
  );
}

/** What an installed plugin bundles, and the ref it is pinned to. */
export function PluginCapabilities({ plugin }: { plugin: InstalledPlugin }) {
  if (plugin.capabilities.length === 0) return null;
  return (
    <div className="plugins-caps">
      {plugin.capabilities.map((c) => (
        <span key={c} className="plugins-cap">
          {c}
        </span>
      ))}
      {plugin.pin && (
        <span className="plugins-pin" title="Pinned ref">
          @{plugin.shortPin}
        </span>
      )}
    </div>
  );
}

export function ContentsSkeleton() {
  return (
    <div className="plugins-contents">
      <Skeleton.Line width="35%" />
      <Skeleton.Line width="60%" style={{ marginTop: 8 }} />
      <Skeleton.Line width="40%" style={{ marginTop: 8 }} />
      <Skeleton.Line width="80%" style={{ marginTop: 14 }} />
      <Skeleton.Line width="70%" style={{ marginTop: 6 }} />
    </div>
  );
}
