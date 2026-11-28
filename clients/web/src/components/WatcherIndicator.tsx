import type { IgniClient } from "../protocol/client";
import { useProcessTable } from "./panels/watcher/useProcessTable";

/** Header status chip for the watcher: shown only while a background
 *  process runs, with their count; click opens it. It keeps its own
 *  count-only table (no output buffered, since the chip is always
 *  mounted), seeded and pushed the same way as the panel's. */
export function WatcherIndicator({ client, onOpen }: { client: IgniClient; onOpen: () => void }) {
  const count = useProcessTable(client, { logs: false }).table.runningCount;
  if (count === 0) return null;
  const what = `background process${count === 1 ? "" : "es"} running`;
  return (
    <button
      type="button"
      className="chip chip-status chip-watcher"
      title={`${count} ${what} — click to open the watcher`}
      onClick={onOpen}
    >
      <span className="chip-watcher-dot" aria-hidden="true" />
      <span className="chip-label">Watcher</span>{" "}
      {/* The name is what shows, then what the count counts:
          "Watcher 2 background processes running". */}
      <span className="chip-status-count">{count}</span>{" "}
      <span className="ui-visually-hidden">{what}</span>
    </button>
  );
}
