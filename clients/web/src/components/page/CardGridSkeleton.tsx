/** Placeholder cards in the shape of an {@link EntityCard} grid, while
 *  the first read is in flight. */

import { Skeleton } from "@ignite-ember/ui-react";

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="card-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="entity-card">
          <Skeleton.Block height={34} width={34} />
          <div style={{ flex: 1 }}>
            <Skeleton.Line width="50%" height={13} />
            <Skeleton.Line width="90%" height={11} style={{ marginTop: 8 }} />
            <Skeleton.Line width="70%" height={11} style={{ marginTop: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
