import type { UpdateInfo } from "../update/updateInfo";

/**
 * The footer under the composer, for what is secondary: the update
 * waiting. The status chips (the watcher, extensions') sit in the
 * header; the session and its context in the composer dock, and the
 * group at the foot of the sidebar. It collapses to nothing (``:empty``)
 * when there is nothing to say.
 */
export function StatusLine({
  pendingUpdate,
  onShowUpdate,
}: {
  pendingUpdate: UpdateInfo | null;
  onShowUpdate: (info: UpdateInfo) => void;
}) {
  return (
    <div className="statusline" style={{ marginTop: 0, paddingBottom: 8 }}>
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
