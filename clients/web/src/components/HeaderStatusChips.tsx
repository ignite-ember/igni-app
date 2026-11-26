import { useEffect, useRef } from "react";

import type { PageRoute } from "../chat/pageStack";
import { ExtensionIndicator } from "../extensions/ExtensionIndicator";
import type { ExtensionSummary } from "../extensions/ExtensionPage";
import { unreadFor, type NotificationCounts } from "../notifications/model";
import type { IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import { WatcherIndicator } from "./WatcherIndicator";

export interface HeaderStatusChipsProps {
  status: StatusUpdate | null;
  extensions: ExtensionSummary[];
  notificationCounts: NotificationCounts;
  onOpenPage: (route: PageRoute) => void;
  client: IgniClient;
}

/**
 * The header's status chips, right of the sidebar toggle: igni's own
 * first, then each extension's in the order the extensions came. One
 * row that scrolls sideways when it runs out of room; collapses
 * (``:empty``) when no chip has anything to say.
 */
export function HeaderStatusChips({ status, extensions, notificationCounts, onOpenPage, client }: HeaderStatusChipsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const shown = status !== null;
  useEffect(() => {
    const row = rowRef.current;
    return shown && row ? watchOverflow(row) : undefined;
  }, [shown]);

  if (!status) return null;
  return (
    <div ref={rowRef} className="header-status-chips" role="group" aria-label="Status">
      <WatcherIndicator client={client} onOpen={() => onOpenPage({ kind: "watcher", label: "Watcher" })} />
      {extensions.flatMap((extension) =>
        extension.indicators.map((indicator) => (
          <ExtensionIndicator
            key={`${extension.id}:${indicator.id}`}
            extensionId={extension.id}
            indicator={indicator}
            unread={unreadFor(notificationCounts, extension.id)}
            onCall={(method, args) => client.asExtension(extension.id).rpc(method, args)}
            onOpen={(kind) => {
              const page = extension.pages.find((p) => p.kind === kind);
              if (page) onOpenPage({ kind: page.kind, label: page.label });
            }}
          />
        )),
      )}
    </div>
  );
}

/** Marks which edges of the row hide chips (``data-overflow``), for the
 *  stylesheet's fade; a DOM attribute, not React state. */
export function watchOverflow(row: HTMLElement): () => void {
  const update = () => {
    const hiddenStart = row.scrollLeft > 1;
    const hiddenEnd = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    const edge = hiddenStart && hiddenEnd ? "both" : hiddenStart ? "start" : hiddenEnd ? "end" : "";
    if (edge) row.dataset.overflow = edge;
    else delete row.dataset.overflow;
  };
  update();
  row.addEventListener("scroll", update, { passive: true });
  const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  resized?.observe(row);
  const changed = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
  changed?.observe(row, { childList: true, subtree: true, characterData: true });
  return () => {
    row.removeEventListener("scroll", update);
    resized?.disconnect();
    changed?.disconnect();
  };
}
