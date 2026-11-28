/** One notification, drawn the same as a toast and as a row of the
 *  sheet: its category's badge, its title and line, where it is from and
 *  when, and its button. What it says is {@link NotificationCard}'s; the
 *  wrapper decides what opening it and the corner button do. */

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import type { NotificationCard as Card } from "../notifications/notificationCard";
import { CategoryIcon } from "./Icons";
import { Button } from "./page/Button";

export interface CardOpener {
  onOpen: () => void;
  /** Its tooltip: where it goes, or why it cannot. */
  title?: string;
  disabled?: boolean;
  /** `button`: the text is a button (the sheet). `pointer`: a click
   *  target, with the keyboard on the buttons beside it (a toast). */
  as: "button" | "pointer";
}

export function NotificationCard({
  card,
  variant,
  opener,
  onAction,
  actionTitle,
  face,
  corner,
  rootProps,
}: {
  card: Card;
  variant: "toast" | "row";
  opener: CardOpener;
  /** What the button does; drawn only when the card has a label for it. */
  onAction?: () => void;
  /** The button's tooltip: where it goes. */
  actionTitle?: string;
  /** Who did it, over the badge's corner. */
  face?: ReactNode;
  /** Dismiss or mark read, top right. */
  corner?: ReactNode;
  rootProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const classes = [
    "ncard",
    `ncard--${variant}`,
    `ncard--${card.category.key}`,
    card.unread ? "is-unread" : "is-read",
    card.prominent && "is-prominent",
    rootProps?.className,
  ]
    .filter(Boolean)
    .join(" ");
  const style = { "--ncard-hue": card.hue } as CSSProperties;

  const said = (
    <>
      <span className="ncard-head">
        <span className="ncard-title">
          {card.title}
          {card.unread && variant === "row" && <span className="sr-only"> (unread)</span>}
        </span>
      </span>
      {card.body && (
        <span className="ncard-body" title={card.body}>
          {card.body}
        </span>
      )}
      <span className="ncard-meta">
        <span className="ncard-category">{card.category.label}</span>
        <span className="ncard-source">
          {card.source}
          {card.org && <span className="ncard-org"> · {card.org}</span>}
        </span>
        {card.actor && <span className="ncard-actor">{card.actor}</span>}
        {card.when && <span className="ncard-when">{card.when}</span>}
      </span>
    </>
  );

  return (
    <div {...rootProps} className={classes} style={style} data-category={card.category.key}>
      <span className="ncard-badge" aria-hidden="true">
        <CategoryIcon category={card.category.key} size={16} />
        {face && <span className="ncard-face">{face}</span>}
      </span>
      {opener.as === "button" ? (
        <button
          type="button"
          className="ncard-open"
          disabled={opener.disabled}
          title={opener.title}
          onClick={() => !opener.disabled && opener.onOpen()}
        >
          {said}
        </button>
      ) : (
        <div className="ncard-open" title={opener.title} onClick={opener.onOpen}>
          {said}
        </div>
      )}
      {card.unread && variant === "row" && <span className="ncard-dot" aria-hidden="true" />}
      {(corner || (card.action && onAction)) && (
        <div className="ncard-side">
          {corner && <div className="ncard-corner">{corner}</div>}
          {card.action && onAction && (
            <Button
              size="sm"
              variant={card.prominent ? "primary" : "secondary"}
              className="ncard-action"
              title={actionTitle}
              onClick={onAction}
            >
              {card.action}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
