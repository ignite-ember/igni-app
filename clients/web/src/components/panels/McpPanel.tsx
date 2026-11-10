import { Skeleton } from "@ignite-ember/ui-react";
import type { IgniClient } from "../../protocol/client";
import { Drawer } from "./Drawer";
import { ADD_SERVER_PROMPT } from "./mcp/addServerPrompt";
import { McpServerEntry } from "./mcp/McpServerEntry";
import { useMcpServers } from "./mcp/useMcpServers";

/** Rows in the shape of a server entry, while the first read is in flight. */
function McpSkeleton() {
  return (
    <div className="mcp-skeleton">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="mcp-skeleton-row">
          <Skeleton.Circle size={10} />
          <div className="mcp-skeleton-text">
            <Skeleton.Line width="35%" height={13} />
            <Skeleton.Line width="60%" height={11} />
          </div>
          <Skeleton.Block height={26} width={86} />
        </div>
      ))}
    </div>
  );
}

export function McpPanel({
  client,
  onClose,
  onAddServer,
}: {
  client: IgniClient;
  onClose: () => void;
  onAddServer: (seed: string) => void;
}) {
  const { servers, busy, loadError, actionError, toggle, setToolEnabled } =
    useMcpServers(client);

  return (
    <Drawer
      title="MCP Servers"
      onClose={onClose}
      headerExtras={
        <div className="mcp-head-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onAddServer(ADD_SERVER_PROMPT)}
          >
            + Add server
          </button>
        </div>
      }
    >
      {servers === null && <McpSkeleton />}
      {loadError && <div className="msg-error">{loadError}</div>}
      {actionError && <div className="msg-error">{actionError}</div>}
      {servers?.length === 0 && !loadError && (
        <div className="msg-info">No MCP servers configured.</div>
      )}
      {servers?.map((s) => (
        <McpServerEntry
          key={s.name}
          server={s}
          busy={busy === s.name}
          onToggle={() => toggle(s)}
          onToolToggle={(tool, enabled) =>
            setToolEnabled(s.name, tool, enabled)
          }
        />
      ))}
    </Drawer>
  );
}
