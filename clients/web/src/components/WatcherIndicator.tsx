import type { IgniClient } from "../protocol/client";
import { useProcessTable } from "./panels/watcher/useProcessTable";

/** Footer pill showing how many background processes are running; click
 *  opens the watcher. Hidden when nothing runs. It keeps its own
 *  count-only table (no output buffered, since the pill is always
 *  mounted), seeded and pushed the same way as the panel's. */
export function WatcherIndicator({ client, onOpen }: { client: IgniClient; onOpen: () => void }) {
  const count = useProcessTable(client, { logs: false }).table.runningCount;
  if (count === 0) return null;

  return (
    <button
      className="watcher-pill"
      title={`${count} background process${count === 1 ? "" : "es"} running — click to open the watcher`}
      onClick={onOpen}
      aria-label="Open watcher panel"
    >
      <span className="watcher-pill-dot" />
      {count} running
    </button>
  );
}
