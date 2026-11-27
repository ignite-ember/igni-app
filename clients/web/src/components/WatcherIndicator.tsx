import type { IgniClient } from "../protocol/client";
import { useProcessTable } from "./panels/watcher/useProcessTable";

/** Header status chip for the watcher, always there; click opens it.
 *  While processes run it pulses and counts them; with none it sits
 *  quiet. It keeps its own count-only table (no output buffered, since
 *  the chip is always mounted), seeded and pushed the same way as the
 *  panel's. */
export function WatcherIndicator({ client, onOpen }: { client: IgniClient; onOpen: () => void }) {
  const count = useProcessTable(client, { logs: false }).table.runningCount;
  const idle = count === 0;
  const what = idle ? "nothing running in the background" : `background process${count === 1 ? "" : "es"} running`;
  return (
    <button
      type="button"
      className={`chip chip-status chip-watcher${idle ? " idle" : ""}`}
      title={idle ? "Nothing running in the background — click to open the watcher" : `${count} ${what} — click to open the watcher`}
      onClick={onOpen}
    >
      <span className="chip-watcher-dot" aria-hidden="true" />
      <span className="chip-label">Watcher</span>{" "}
      {/* The name is what shows, then what the count counts:
          "Watcher 2 background processes running". */}
      {!idle && (
        <>
          <span className="chip-status-count">{count}</span>{" "}
        </>
      )}
      <span className="ui-visually-hidden">{what}</span>
    </button>
  );
}
