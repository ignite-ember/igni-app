/** One part of a thing's own page — its tools, its source, its README:
 *  a soft filled card with a small uppercase label (and a count) at its
 *  top, the content below. Stack several under an {@link EntityHero}
 *  inside `.entity-detail`, which spaces them. */

import type { ReactNode } from "react";

export interface DetailSectionProps {
  /** The label at the top of the card; also its accessible name. */
  title: string;
  /** A count chip beside the label; nothing is drawn without it. */
  count?: number | null;
  /** Quiet controls at the right of the label row: `secondary` or
   *  `icon` {@link Button}s at `size="sm"`. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function DetailSection({ title, count, actions, className, children }: DetailSectionProps) {
  return (
    <section className={className ? `detail-section ${className}` : "detail-section"} aria-label={title}>
      <div className="detail-section-head">
        <span className="detail-section-title">{title}</span>
        {count != null && <span className="detail-section-count">{count}</span>}
        {actions && <span className="detail-section-actions">{actions}</span>}
      </div>
      <div className="detail-section-body">{children}</div>
    </section>
  );
}
