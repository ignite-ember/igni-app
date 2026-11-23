import { useState } from "react";
import { Skeleton } from "@ignite-ember/ui-react";
import type { IgniClient } from "../../protocol/client";
import { FilterIcon, NamedIcon, SortIcon } from "../Icons";
import { ControlMenu } from "./ControlMenu";
import { Drawer } from "./Drawer";
import { PanelSearch } from "./PanelSearch";
import { ADD_SERVER_PROMPT } from "./mcp/addServerPrompt";
import { McpServer } from "./mcp/mcpServer";
import { McpServerEntry } from "./mcp/McpServerEntry";
import { useMcpServers } from "./mcp/useMcpServers";

type McpSort = "default" | "name-asc" | "name-desc";
type McpFilter = "all" | "connected" | "disconnected" | "needs-approval";

const MCP_SORTS: readonly { key: McpSort; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "name-asc", label: "Name A→Z" },
  { key: "name-desc", label: "Name Z→A" },
];
const MCP_FILTERS: readonly { key: McpFilter; label: string }[] = [
  { key: "all", label: "All servers" },
  { key: "connected", label: "Connected" },
  { key: "disconnected", label: "Disconnected" },
  { key: "needs-approval", label: "Needs approval" },
];

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
  const { servers, approvals, busy, loadError, actionError, toggle, setToolEnabled, setApproval } =
    useMcpServers(client);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<McpSort>("default");
  const [filterBy, setFilterBy] = useState<McpFilter>("all");
  const [openMenu, setOpenMenu] = useState<"sort" | "filter" | null>(null);
  // A configured server the details left out still needs its answer.
  const listed = new Set(servers?.map((s) => s.name));
  const unlisted = servers
    ? [...approvals.values()]
        .filter((a) => !listed.has(a.name))
        .map((a) => McpServer.parse({ name: a.name, connected: false }))
    : [];
  const all = [...(servers ?? []), ...unlisted];
  const term = query.trim().toLowerCase();
  const matchesFilter = (s: McpServer): boolean => {
    if (filterBy === "all") return true;
    const waiting = approvals.get(s.name)?.waiting === true;
    if (filterBy === "needs-approval") return waiting;
    if (filterBy === "connected") return s.connected;
    return !s.connected && !waiting; // disconnected
  };
  let shown = all.filter((s) => (!term || s.name.toLowerCase().includes(term)) && matchesFilter(s));
  if (sortBy === "name-asc") shown = [...shown].sort((a, b) => a.name.localeCompare(b.name));
  else if (sortBy === "name-desc") shown = [...shown].sort((a, b) => b.name.localeCompare(a.name));

  return (
    <Drawer
      title="MCP Servers"
      onClose={onClose}
      headerExtras={
        <div className="plugins-controls">
          {all.length > 0 && (
            <>
              <PanelSearch
                value={query}
                onChange={setQuery}
                label="Search MCP servers"
                placeholder={`Search ${all.length} MCP server${all.length === 1 ? "" : "s"}…`}
              />
              <ControlMenu
                label="Filter"
                icon={<FilterIcon />}
                active={filterBy !== "all"}
                open={openMenu === "filter"}
                onToggle={() => setOpenMenu(openMenu === "filter" ? null : "filter")}
                onClose={() => setOpenMenu(null)}
                options={MCP_FILTERS}
                current={filterBy}
                onPick={setFilterBy}
              />
              <ControlMenu
                label="Sort"
                icon={<SortIcon />}
                active={sortBy !== "default"}
                open={openMenu === "sort"}
                onToggle={() => setOpenMenu(openMenu === "sort" ? null : "sort")}
                onClose={() => setOpenMenu(null)}
                options={MCP_SORTS}
                current={sortBy}
                onPick={setSortBy}
              />
            </>
          )}
          <button
            className="kb-icon-btn"
            onClick={() => onAddServer(ADD_SERVER_PROMPT)}
            title="Add an MCP server"
            aria-label="Add an MCP server"
          >
            <NamedIcon name="plus" />
          </button>
        </div>
      }
    >
      {servers === null && <McpSkeleton />}
      {loadError && <div className="msg-error">{loadError}</div>}
      {actionError && <div className="msg-error">{actionError}</div>}
      {servers?.length === 0 && unlisted.length === 0 && !loadError && (
        <div className="msg-info">No MCP servers configured.</div>
      )}
      {all.length > 0 && shown.length === 0 && (
        <div className="plugins-empty">
          <div className="plugins-empty-title">No MCP servers match</div>
        </div>
      )}
      {shown.length > 0 && (
        <div className="plugins-grid plugins-grid--start">
          {shown.map((s) => (
            <McpServerEntry
              key={s.name}
              server={s}
              approval={approvals.get(s.name)}
              busy={busy === s.name}
              onToggle={() => toggle(s)}
              onToolToggle={(tool, enabled) => setToolEnabled(s.name, tool, enabled)}
              onApprove={(approved) => setApproval(s.name, approved)}
            />
          ))}
        </div>
      )}
    </Drawer>
  );
}
