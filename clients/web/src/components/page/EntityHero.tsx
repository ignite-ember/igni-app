/** The top of one thing's own page: a large icon tile, its name as the
 *  page's heading, a line of meta beside it, what it is, and what can
 *  be done to it. The page frame should pass `titleInBody` so the name
 *  is not drawn twice. */

import type { ReactNode } from "react";

import { EntityGlyph } from "../EntityGlyph";

export interface EntityHeroProps {
  name: string;
  /** Replaces the initials tile. */
  icon?: ReactNode;
  /** Before the name on its row — a status dot. */
  leading?: ReactNode;
  /** After the name on its row — a version, a state, a source. Use
   *  `.entity-meta` for quiet text. */
  meta?: ReactNode;
  description?: ReactNode;
  /** Chips under the description; nothing is drawn without them. */
  chips?: ReactNode;
  /** Buttons along the bottom. */
  actions?: ReactNode;
}

export function EntityHero({ name, icon, leading, meta, description, chips, actions }: EntityHeroProps) {
  return (
    <div className="entity-hero">
      <span className="entity-hero-icon" aria-hidden="true">
        {icon ?? <EntityGlyph name={name} size={52} />}
      </span>
      <div className="entity-hero-main">
        <div className="entity-hero-title-row">
          {leading}
          <h2 className="entity-hero-title">{name}</h2>
          {meta}
        </div>
        {description && <div className="entity-hero-desc">{description}</div>}
        {chips && <div className="entity-hero-chips">{chips}</div>}
        {actions && <div className="entity-hero-actions">{actions}</div>}
      </div>
    </div>
  );
}
