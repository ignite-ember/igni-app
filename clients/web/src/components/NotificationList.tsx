/**
 * Notifications, whichever extension they are from, grouped by day.
 *
 * Notifications are the floor's (igni server's
 * `docs/service-identity.md` §10) and every extension has its own kinds,
 * so a row says what the notification itself says: its title, its line
 * of body, which extension (and organisation, for somebody in more than
 * one), who did it, and when. Unread rows carry a quiet dot.
 *
 * **Reading is not doing.** Opening a row goes to the extension page it
 * names, where the thing can be answered; the only action here is
 * marking it read.
 */
import type { ReactNode } from "react";
import { Monogram } from "@ignite-ember/ui-react";

import { NotificationDays } from "../notifications/dayGroups";
import type { FloorNotification } from "../notifications/model";
import { EntityGlyph } from "./EntityGlyph";
import { CheckIcon } from "./Icons";
import { Button } from "./page/Button";
import { PageEmpty } from "./page/PageEmpty";

export type { FloorNotification };

export function when(iso: string | null | undefined): string {
  const at = Date.parse(iso || "");
  if (Number.isNaN(at)) return "";
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface RowProps {
  row: FloorNotification;
  from: string;
  openable: boolean;
  onOpen?: (row: FloorNotification) => void;
  onMarkRead?: (row: FloorNotification) => void;
}

function NotificationRow({ row, from, openable, onOpen, onMarkRead }: RowProps) {
  return (
    <li className={row.read ? "notify-row is-read" : "notify-row is-unread"}>
      <button
        type="button"
        className="notify-open"
        disabled={!openable}
        title={openable ? `Open in ${from}` : `${from} is not installed here, so this cannot be opened`}
        onClick={() => openable && onOpen?.(row)}
      >
        {!row.read && <span className="notify-dot" aria-hidden="true" />}
        {/* A person gets their hue, as everywhere; an extension's own
            notice a neutral tile. */}
        <span className="notify-face">
          {row.actor ? <Monogram name={row.actor} size={28} /> : <EntityGlyph name={from} size={28} />}
        </span>
        <span className="notify-said">
          <span className="notify-line">
            <strong>{row.title || row.kind}</strong>
            {!row.read && <span className="sr-only"> (unread)</span>}
          </span>
          {row.body && <span className="notify-excerpt">{row.body}</span>}
          <span className="notify-meta">
            <span className="notify-source">
              {from}
              {row.org_name && <span className="notify-org"> · {row.org_name}</span>}
            </span>
            {row.actor && row.actor !== from && <span className="notify-actor">{row.actor}</span>}
            {row.created_at && <span className="notify-when">{when(row.created_at)}</span>}
          </span>
        </span>
      </button>
      {!row.read && onMarkRead && (
        <div className="notify-actions">
          <Button variant="icon" label="Mark as read" onClick={() => onMarkRead(row)}>
            <CheckIcon size={13} />
          </Button>
        </div>
      )}
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
