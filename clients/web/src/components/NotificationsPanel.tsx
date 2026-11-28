/**
 * What is waiting on you, in a sheet down the right.
 *
 * It opens over the app and closes again, and what was underneath is
 * still there: "is anybody waiting on me" gets asked between other
 * pieces of work and should be answerable without abandoning them.
 *
 * Like every page, its header row stays put and the list fades under it
 * (`FadeScroll`). The list is the floor's, not an extension's: igni's
 * backend merges what igni server delivered with what extensions on
 * this machine told it (igni server's `docs/service-identity.md` §10).
 * Opening a row goes to the extension page it names and marks it read
 * where it lives; the backend knows which.
 */
import { useEffect, useState } from "react";

import type {
  FloorNotification,
  NotificationCounts,
  NotificationTarget,
} from "../notifications/model";
import { useFloorNotifications } from "../notifications/useFloorNotifications";
import type { IgniClient } from "../protocol/client";
import { CloseIcon } from "./Icons";
import { NotificationList } from "./NotificationList";
import { Button } from "./page/Button";
import { FadeScroll } from "./page/FadeScroll";
import { PageEmpty } from "./page/PageEmpty";
import { PageLoading } from "./page/PageLoading";
import { PageTabs } from "./page/PageTabs";

type Show = "all" | "unread";

const TABS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
] as const;

export function NotificationsPanel({
  client,
  sourceName,
  canOpen,
  onOpenTarget,
  onCountsChanged,
  onClose,
}: {
  client: IgniClient;
  /** The extension's name, for its id. */
  sourceName?: (source: string) => string;
  /** Whether this app has a page called `page` right now. */
  canOpen?: (page: string) => boolean;
  /** Go to the page a notification names. The panel closes on the way,
   *  so it does not cover the answer. */
  onOpenTarget?: (target: NotificationTarget, row: FloorNotification) => void;
  /** The counts, every time this learns them — marking something read
   *  moves every badge, not only this list. */
  onCountsChanged?: (counts: NotificationCounts) => void;
  onClose: () => void;
}) {
  const feed = useFloorNotifications(client, onCountsChanged);
  const [show, setShow] = useState<Show>("all");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = show === "unread" ? feed.rows.filter((row) => !row.read) : feed.rows;
  const open = (row: FloorNotification) => {
    if (!row.target) return;
    // Opening it is what reading it means.
    if (!row.read) void feed.markRead([row.id]);
    onOpenTarget?.(row.target, row);
    onClose();
  };

  const chrome = (
    <div className="notify-head">
      <div className="notify-titlebar">
        <div className="notify-heading">
          <h2 className="notify-title">Notifications</h2>
          <span className="notify-count">
            {feed.unread ? `${feed.unread} unread` : "nothing unread"}
          </span>
        </div>
        {!!feed.unread && (
          <Button size="sm" title="Mark everything as read" onClick={() => void feed.markAllRead()}>
            Mark all read
          </Button>
        )}
        <Button variant="icon" size="md" label="Close notifications" title="Close (Esc)" onClick={onClose}>
          <CloseIcon />
        </Button>
      </div>
      <PageTabs tabs={TABS} current={show} onSelect={setShow} />
    </div>
  );

  return (
    <>
      {/* Dimmed rather than blocked: what is underneath is still the
          thing being worked on. */}
      <div className="notify-backdrop" onClick={onClose} />
      {/* A <div>, not an <aside>: `role="dialog"` is not allowed on
          <aside>. R683. */}
      <div className="notify-panel" role="dialog" aria-label="Notifications" aria-modal="false">
        <FadeScroll chrome={chrome} className="notify-body">
          {feed.failed && (
            <p className="notify-error" role="status">
              {feed.failed}
            </p>
          )}
          {feed.loaded ? (
            <NotificationList
              rows={shown}
              sourceName={sourceName}
              canOpen={(row) => !!row.target && (canOpen?.(row.target.page) ?? true)}
              onOpen={open}
              onMarkRead={(row) => void feed.markRead([row.id])}
              empty={
                show === "unread" && feed.rows.length ? (
                  <PageEmpty
                    title="Nothing unread"
                    hint="Everything here has been read."
                    action={<Button size="sm" onClick={() => setShow("all")}>Show all</Button>}
                  />
                ) : undefined
              }
            />
          ) : (
            <PageLoading label="Reading notifications…" />
          )}
        </FadeScroll>
      </div>
    </>
  );
}
