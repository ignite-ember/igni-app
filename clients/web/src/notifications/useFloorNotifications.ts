/**
 * The floor's notification list and its unread count, read from igni's
 * backend and read again whenever the counts move.
 *
 * A failed read keeps the rows it had and says why: emptying the list
 * would say "nothing is waiting", the one answer this must not give
 * wrongly. Marking read reports the counts it learns, so every badge
 * moves, then reads the list again to show what is actually true.
 */
import { useCallback, useEffect, useState } from "react";

import type { IgniClient } from "../protocol/client";
import {
  countsFromPush,
  isCounts,
  type FloorNotification,
  type NotificationCounts,
} from "./model";

interface ListAnswer {
  notifications?: FloorNotification[];
  counts?: NotificationCounts;
  server_error?: string;
  error?: string;
}

export interface FloorNotifications {
  rows: FloorNotification[];
  unread: number;
  /** Why the last read fell short; empty when it did not. */
  failed: string;
  /** Whether a first answer (or a failure) has come back. */
  loaded: boolean;
  /** Mark these read, then read the list again. */
  markRead: (ids: string[]) => Promise<void>;
  /** Mark everything read, then read the list again. */
  markAllRead: () => Promise<void>;
}

export function useFloorNotifications(
  client: IgniClient,
  onCountsChanged?: (counts: NotificationCounts) => void,
): FloorNotifications {
  const [rows, setRows] = useState<FloorNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState("");
  const [loaded, setLoaded] = useState(false);

  const learned = useCallback(
    (counts: unknown) => {
      if (!isCounts(counts)) return;
      setUnread(counts.unread);
      onCountsChanged?.(counts);
    },
    [onCountsChanged],
  );

  const load = useCallback(async () => {
    try {
      const answer = await client.rpc<ListAnswer>("notifications_list");
      if (answer?.error) throw new Error(answer.error);
      setRows(answer?.notifications ?? []);
      learned(answer?.counts);
      setFailed(answer?.server_error ?? "");
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [client, learned]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      client.onEvent((message) => {
        if (countsFromPush(message)) void load();
      }),
    [client, load],
  );

  const mark = useCallback(
    async (args: Record<string, unknown>) => {
      try {
        const answer = await client.rpc<{ counts?: NotificationCounts }>("notifications_mark_read", args);
        learned(answer?.counts);
      } catch {
        // The next read shows whatever is actually true.
      }
    },
    [client, learned],
  );

  const markRead = useCallback(
    async (ids: string[]) => {
      await mark({ ids });
      await load();
    },
    [mark, load],
  );

  const markAllRead = useCallback(async () => {
    await mark({});
    await load();
  }, [mark, load]);

  return { rows, unread, failed, loaded, markRead, markAllRead };
}
