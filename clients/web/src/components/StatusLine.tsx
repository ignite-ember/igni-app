import type { PageRoute } from "../chat/pageStack";
import type { BackendSnapshot } from "../cloud/backendState";
import type { ExtensionSummary } from "../extensions/ExtensionPage";
import { ExtensionIndicator } from "../extensions/ExtensionIndicator";
import { unreadFor, type NotificationCounts } from "../notifications/model";
import type { IgniClient } from "../protocol/client";
import type { StatusUpdate } from "../protocol/messages";
import type { UpdateInfo } from "../update/updateInfo";
import { BackendChip } from "./BackendChip";
import { GroupIndicator } from "./GroupIndicator";
import { CtxMeter, SessionChip } from "./StatusBits";
import { WatcherIndicator } from "./WatcherIndicator";

/** How full the context window is, as a whole percentage. */
function contextPercent(status: StatusUpdate): number {
  return Math.round((status.context_tokens / Math.max(status.max_context, 1)) * 100);
}

/**
 * The footer under the composer: this session and its footprint, the
 * watcher and group chips, the side igni runs on (desktop), each
 * installed extension's own chips, and the update waiting.
 */
export function StatusLine({
  status,
  sessionId,
  client,
  extensions,
  notificationCounts,
  pendingUpdate,
  onShowUpdate,
  onOpen,
  backend = null,
}: {
  status: StatusUpdate | null;
  sessionId: string;
  client: IgniClient;
  extensions: ExtensionSummary[];
  notificationCounts: NotificationCounts;
  pendingUpdate: UpdateInfo | null;
  onShowUpdate: (info: UpdateInfo) => void;
  onOpen: (route: PageRoute) => void;
  /** The desktop's cloud switch, when the shell has one. */
  backend?: BackendSnapshot | null;
}) {
  return (
    <div className="statusline" style={{ marginTop: 0, paddingBottom: 8 }}>
      {status && (
        <>
          <SessionChip sessionId={sessionId} />
          {/* Beside the session: both say "this session". */}
          <CtxMeter tokens={status.context_tokens} max={status.max_context} pct={contextPercent(status)} />
          <WatcherIndicator client={client} onOpen={() => onOpen({ kind: "watcher", label: "Watcher" })} />
          <GroupIndicator client={client} />
          {/* Beside the group: the group decides where igni runs. */}
          <BackendChip backend={backend} />
          {/* Extensions' chips are data, not frames: the extension says
              what it shows and the host draws it. */}
          {extensions.flatMap((extension) =>
            extension.indicators.map((indicator) => (
              <ExtensionIndicator
                key={indicator.id}
                extensionId={extension.id}
                indicator={indicator}
                unread={unreadFor(notificationCounts, extension.id)}
                onCall={(method, args) => client.asExtension(extension.id).rpc(method, args)}
                onOpen={(kind) => {
                  const page = extension.pages.find((p) => p.kind === kind);
                  if (page) onOpen({ kind: page.kind, label: page.label });
                }}
              />
            )),
          )}
        </>
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
