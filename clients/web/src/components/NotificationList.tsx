/**
 * Notifications, whichever extension they are from, grouped by day.
 *
 * Notifications are the floor's (igni server's
 * `docs/service-identity.md` §10) and every extension has its own kinds,
 * so a row says what the notification itself says — its title, its line
 * of body, which extension (and organisation, for somebody in more than
 * one), who did it, and when — in the card its category draws
 * ({@link NotificationCard}): its badge, its hue, and for what waits on
 * you, a louder card and a button.
 *
 * **Reading is not doing.** Opening a row goes to the extension page it
 * names, where the thing can be answered; the only action here besides
 * that is marking it read.
 */
import type { ReactNode } from "react";
import { Monogram } from "@ignite-ember/ui-react";

import { NotificationDays } from "../notifications/dayGroups";
import type { FloorNotification } from "../notifications/model";
import { NotificationCard as Card, relativeTime } from "../notifications/notificationCard";
import { CheckIcon } from "./Icons";
import { NotificationCard } from "./NotificationCard";
import { Button } from "./page/Button";
import { PageEmpty } from "./page/PageEmpty";

export type { FloorNotification };

/** How long ago, in a word or two. */
export const when = (iso: string | null | undefined): string => relativeTime(iso);

interface RowProps {
  row: FloorNotification;
  from: string;
  openable: boolean;
  onOpen?: (row: FloorNotification) => void;
  onMarkRead?: (row: FloorNotification) => void;
}

function NotificationRow({ row, from, openable, onOpen, onMarkRead }: RowProps) {
  const card = Card.fromFloor(row, from, openable);
  const open = () => openable && onOpen?.(row);
  return (
    <li className={row.read ? "notify-row is-read" : "notify-row is-unread"}>
      <NotificationCard
        card={card}
        variant="row"
        opener={{
          as: "button",
          onOpen: open,
          disabled: !openable,
          title: openable ? `Open in ${from}` : `${from} is not installed here, so this cannot be opened`,
        }}
        onAction={open}
        actionTitle={`Open in ${from}`}
        face={card.actor ? <Monogram name={card.actor} size={16} /> : undefined}
        corner={
          !row.read && onMarkRead ? (
            <Button variant="icon" size="sm" className="notify-mark" label="Mark as read" onClick={() => onMarkRead(row)}>
              <CheckIcon size={12} />
            </Button>
          ) : undefined
        }
      />
    </li>
  );
}

export function NotificationList({
  rows,
  sourceName = (id) => id,
  canOpen = () => true,
  onOpen,
  onMarkRead,
  days = new NotificationDays(),
  empty,
}: {
  rows: FloorNotification[];
  /** The extension's name, for its id. Its id when it is not installed. */
  sourceName?: (source: string) => string;
  /** Whether this app has the page a notification points at. */
  canOpen?: (row: FloorNotification) => boolean;
  /** Go where it points. */
  onOpen?: (row: FloorNotification) => void;
  /** Mark one read, from its hover action. */
  onMarkRead?: (row: FloorNotification) => void;
  /** How rows are grouped into days; today's by default. */
  days?: NotificationDays;
  /** What to show instead when there are no rows. */
  empty?: ReactNode;
}) {
  if (!rows.length) {
    return <>{empty ?? <PageEmpty title="You're all caught up" hint="Nothing is waiting on you." />}</>;
  }
  return (
    <div className="notify-days">
      {days.group(rows).map((day) => (
        <section key={day.key} className="notify-day" aria-label={day.label}>
          <h3 className="notify-day-label">{day.label}</h3>
          <ul className="notify-rows">
            {day.rows.map((row) => (
              <NotificationRow
                key={`${row.origin}:${row.id}`}
                row={row}
                from={sourceName(row.source)}
                openable={row.target !== null && canOpen(row)}
                onOpen={onOpen}
                onMarkRead={onMarkRead}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
