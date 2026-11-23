import type { PageRoute } from "../chat/pageStack";
import type { IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import type { UpdateInfo } from "../update/updateInfo";
import { WatcherIndicator } from "./WatcherIndicator";

/**
 * The footer under the composer, for what is secondary: the watcher
 * chip and the update waiting. Extensions' status chips moved up to the
 * header; the session and its context sit in the composer dock, and the
 * group at the foot of the sidebar. It collapses to nothing (``:empty``)
 * when there is nothing to say.
 */
export function StatusLine({
  status,
  client,
  pendingUpdate,
  onShowUpdate,
  onOpen,
}: {
  status: StatusUpdate | null;
  client: IgniClient;
  pendingUpdate: UpdateInfo | null;
  onShowUpdate: (info: UpdateInfo) => void;
  onOpen: (route: PageRoute) => void;
}) {
  return (
    <div className="statusline" style={{ marginTop: 0, paddingBottom: 8 }}>
      {status && (
        <WatcherIndicator client={client} onOpen={() => onOpen({ kind: "watcher", label: "Watcher" })} />
      )}
      {pendingUpdate && (
        <button
          type="button"
          className="brand-update"
          title={`Update to v${pendingUpdate.latestVersion}`}
          onClick={() => onShowUpdate(pendingUpdate)}
        >
          Update to v{pendingUpdate.latestVersion}
        </button>
      )}
    </div>
  );
}
