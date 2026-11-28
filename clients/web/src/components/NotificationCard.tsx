/** One notification, drawn the same as a toast and as a row of the
 *  sheet: its category's badge, its title and line, where it is from and
 *  when, and — when it reaches something — a button naming it. What it
 *  says and reaches is {@link NotificationCard}'s; the wrapper decides
 *  what else following it does (dismiss, mark read, close the sheet). */

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import type { NotificationCard as Card } from "../notifications/notificationCard";
import { CategoryIcon } from "./Icons";
import { Button } from "./page/Button";

export function NotificationCard({
  card,
  variant,
  onFollow,
  face,
  corner,
  rootProps,
}: {
  card: Card;
  variant: "toast" | "row";
  /** Follow the card's action: the wrapper runs it, and its own part. */
  onFollow: () => void;
  /** Who did it, over the badge's corner. */
  face?: ReactNode;
  /** Dismiss or mark read, top right. */
  corner?: ReactNode;
  rootProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const action = card.action;
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
      <div className="ncard-col">
        {variant === "row" ? (
          // The sheet: the words are words. Only the button opens
          // anything, and it says what it opens.
          <div className="ncard-open">{said}</div>
        ) : (
          // A toast: the text is a click target for the pointer; the
          // keyboard has the buttons beside it.
          <div className="ncard-open" title={action?.label} onClick={onFollow}>
            {said}
          </div>
        )}
        {action && card.button && (
          <div className="ncard-actions">
            <Button
              size="sm"
              variant={card.prominent ? "primary" : "secondary"}
              className="ncard-action"
              label={action.label}
              title={action.label}
              onClick={onFollow}
            >
              {action.text}
            </Button>
          </div>
        )}
      </div>
      {card.unread && variant === "row" && <span className="ncard-dot" aria-hidden="true" />}
      {corner && <div className="ncard-corner">{corner}</div>}
    </div>
  );
}
