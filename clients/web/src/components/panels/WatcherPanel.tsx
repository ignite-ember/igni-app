/**
 * Right-side panel listing the background shell processes the agent or
 * the user has started, running and finished, with a live tail and a
 * Kill button for each. The data lives in {@link useWatcher}; this is
 * the layout.
 */
import { useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { Drawer } from "./Drawer";
import { useNow } from "./watcher/useNow";
import { useWatcher } from "./watcher/useWatcher";
import { WatcherRow } from "./watcher/WatcherRow";
import { WatcherTail } from "./watcher/WatcherTail";

export function WatcherPanel({ client, onClose }: { client: IgniClient; onClose: () => void }) {
  const watcher = useWatcher(client);
  const { table, selected } = watcher;
  const [filter, setFilter] = useState("");
  const now = useNow();

  return (
    <Drawer
      // The selected pid is a level on the page's trail, so the title stays constant.
      levels={{
        labels: selected ? [`PID ${selected.pid}`] : [],
        onTruncate: watcher.deselect,
      }}
      title={
        selected ? (
          <span>Watcher</span>
        ) : (
          <span>
            Watcher <span className="watcher-count">{table.countLabel}</span>
          </span>
        )
      }
      onClose={onClose}
    >
      {watcher.loadError && <div className="msg-error">{watcher.loadError}</div>}
      {watcher.actionError && <div className="msg-error">{watcher.actionError}</div>}
      {table.rows.size === 0 ? (
        <div className="msg-info">
          Nothing has run here yet. Anything you start with <code>$ </code> — or that the agent backgrounds itself —
          shows up here while it runs, and stays afterwards with its exit code.
        </div>
      ) : (
        <div className={`watcher-layout ${selected ? "watcher-layout--split" : "watcher-layout--list-only"}`}>
          <ul className="watcher-list">
            {(selected ? [selected] : table.sorted).map((row) => (
              <WatcherRow
                key={row.pid}
                row={row}
                selected={row.pid === selected?.pid}
                now={now}
                onToggle={() => watcher.toggle(row.pid)}
                onKill={() => watcher.kill(row.pid)}
              />
            ))}
          </ul>
          {selected && <WatcherTail lines={table.logsOf(selected.pid)} filter={filter} onFilter={setFilter} />}
        </div>
      )}
    </Drawer>
  );
}
