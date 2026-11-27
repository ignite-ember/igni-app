/** One thing on a card page — a plugin, an agent, a skill, a workflow, a
 *  task: a quiet icon tile, its name in plain type, two lines of
 *  description, a row of soft neutral chips and a faint footer, on a soft
 *  filled card that only draws a border on hover. Every card page draws
 *  this one card and adds no look of its own. Lay several out with
 *  {@link CardGrid}. */

import type { KeyboardEvent, ReactNode } from "react";

import { EntityGlyph } from "../EntityGlyph";

export interface EntityCardProps {
  /** The name line. A string is also what the initials tile is drawn
   *  from; pass `glyph` when the line is richer than the name. */
  name: ReactNode;
  /** The name the initials come from, when `name` is not a string. */
  glyph?: string;
  /** Replaces the initials tile — a category's own icon, say. Wrap it
   *  in `.entity-glyph` to keep the tile's shape. */
  icon?: ReactNode;
  /** One control at the top right — a {@link CardAction}, or a chevron.
   *  Its keys never open the card; a button here stops its own click
   *  from reaching the card (CardAction does). */
  action?: ReactNode;
  /** Clamped to two lines. */
  description?: ReactNode;
  /** {@link HeroChip}s under the description, in their own row. */
  chips?: ReactNode;
  /** Faint meta along the bottom — a source, a count, a model — as
   *  `.entity-meta` spans; spaced, never coloured. */
  footer?: ReactNode;
  /** Makes the whole card a button: click, Enter or Space opens it. */
  onOpen?: () => void;
  /** Accessible name when the card is a button and `name` is not text. */
  label?: string;
  className?: string;
  /** Anything else the card holds, under the footer. */
  children?: ReactNode;
}

export function EntityCard({
  name,
  glyph,
  icon,
  action,
  description,
  chips,
  footer,
  onOpen,
  label,
  className,
  children,
}: EntityCardProps) {
  const initials = glyph ?? (typeof name === "string" ? name : "");
  // Only keys aimed at the card itself: Enter on the action button
  // inside it is that button's, not a request to open the card.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen?.();
    }
  };
  return (
    <div
      className={className ? `entity-card ${className}` : "entity-card"}
      {...(onOpen
        ? { role: "button", tabIndex: 0, "aria-label": label, onClick: onOpen, onKeyDown }
        : {})}
    >
      <span className="entity-card-icon" aria-hidden="true">
        {icon ?? <EntityGlyph name={initials} size={38} />}
      </span>
      <div className="entity-card-body">
        <div className="entity-card-top">
          <span className="entity-card-name">{name}</span>
          {action}
        </div>
        {description && <p className="entity-card-desc">{description}</p>}
        {chips && <div className="entity-card-chips">{chips}</div>}
        {footer && <div className="entity-card-foot">{footer}</div>}
        {children}
      </div>
    </div>
  );
}
