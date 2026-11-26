/** Small pieces the plugins page repeats: a plugin's capability chips
 *  and the contents' loading placeholder. */

import { Skeleton } from "@ignite-ember/ui-react";
import { DetailSection } from "../../page/DetailSection";
import { HeroChip } from "../../page/HeroChip";
import type { InstalledPlugin } from "./installedPlugin";

/** What an installed plugin bundles, and the ref it is pinned to. */
export function PluginCapabilities({ plugin }: { plugin: InstalledPlugin }) {
  if (plugin.capabilities.length === 0) return null;
  return (
    <>
      {plugin.capabilities.map((c) => (
        <HeroChip key={c}>{c}</HeroChip>
      ))}
      {plugin.pin && <HeroChip title="Pinned ref">@{plugin.shortPin}</HeroChip>}
    </>
  );
}

export function ContentsSkeleton() {
  return (
    <DetailSection title="Contents">
      <Skeleton.Line width="35%" />
      <Skeleton.Line width="60%" style={{ marginTop: 8 }} />
      <Skeleton.Line width="40%" style={{ marginTop: 8 }} />
      <Skeleton.Line width="80%" style={{ marginTop: 14 }} />
      <Skeleton.Line width="70%" style={{ marginTop: 6 }} />
    </DetailSection>
  );
}
