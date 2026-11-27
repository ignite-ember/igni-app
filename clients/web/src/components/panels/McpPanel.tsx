import { useLayoutEffect, useRef, useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { CardGrid } from "../page/CardGrid";
import { CardGridSkeleton } from "../page/CardGridSkeleton";
import { PageEmpty } from "../page/PageEmpty";
import { PageHeaderControls } from "../page/PageHeaderControls";
import { Drawer } from "./Drawer";
import { ADD_SERVER_PROMPT } from "./mcp/addServerPrompt";
import { McpServer } from "./mcp/mcpServer";
import { McpServerCard } from "./mcp/McpServerCard";
import { McpServerDetail } from "./mcp/McpServerDetail";
import { McpServerState } from "./mcp/mcpServerState";
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

export function McpPanel({
  client,
  onClose,
  onAddServer,
}: {
  client: IgniClient;
  onClose: () => void;
  onAddServer: (seed: string) => void;
}) {
  const {
    servers,
    approvals,
    busy,
    loadError,
    actionError,
    toggle,
    setToolEnabled,
    setApproval,
    reload,
    reloading,
  } = useMcpServers(client);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<McpSort>("default");
  const [filterBy, setFilterBy] = useState<McpFilter>("all");
  // The server whose own page is open, by name, so a re-read shows its
  // fresh state; the list comes back when it is gone.
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // Where the list was scrolled when a server opened, to land there again.
  const anchor = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const scroller = () => anchor.current?.closest<HTMLElement>(".page-body, .drawer-body") ?? null;
  // A configured server the details left out still needs its answer.
  const listed = new Set(servers?.map((s) => s.name));
  const unlisted = servers
    ? [...approvals.values()]
        .filter((a) => !listed.has(a.name))
        .map((a) => McpServer.parse({ name: a.name, connected: false }))
    : [];
  const all = [...(servers ?? []), ...unlisted];
  const stateOf = (s: McpServer) => new McpServerState(s, approvals.get(s.name));
  const selected = all.find((s) => s.name === selectedName) ?? null;

  const isOpen = selected !== null;

  useLayoutEffect(() => {
    const el = scroller();
    if (el) el.scrollTop = isOpen ? 0 : listScroll.current;
  }, [isOpen]);

  const open = (s: McpServer) => {
    listScroll.current = scroller()?.scrollTop ?? 0;
    setSelectedName(s.name);
  };
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
      levels={{
        labels: selected ? [selected.name] : [],
        onTruncate: () => setSelectedName(null),
      }}
      // The server's page opens with its own name in the hero.
      titleInBody={selected !== null}
      headerExtras={
        selected ? null : (
          <PageHeaderControls
            search={
              all.length > 0
                ? {
                    value: query,
                    onChange: setQuery,
                    label: "Search MCP servers",
                    placeholder: `Search ${all.length} MCP server${all.length === 1 ? "" : "s"}…`,
                  }
                : undefined
            }
            filter={
              all.length > 0
                ? { options: MCP_FILTERS, current: filterBy, onPick: setFilterBy }
                : undefined
            }
            sort={
              all.length > 0 ? { options: MCP_SORTS, current: sortBy, onPick: setSortBy } : undefined
            }
            refresh={{
              onClick: reload,
              busy: reloading,
              label: "Reload MCP config",
              title: "Reload .mcp.json — pick up servers added, edited or removed",
            }}
            add={{
              text: "Add server",
              label: "Add server",
              title: "Add an MCP server",
              onClick: () => onAddServer(ADD_SERVER_PROMPT),
            }}
          />
        )
      }
    >
      <div ref={anchor} className="mcp-page">
        {loadError && <div className="msg-error">{loadError}</div>}
        {actionError && <div className="msg-error">{actionError}</div>}
        {selected ? (
          <McpServerDetail
            state={stateOf(selected)}
            busy={busy === selected.name}
            onToggle={() => toggle(selected)}
            onToolToggle={(tool, enabled) => setToolEnabled(selected.name, tool, enabled)}
            onApprove={(approved) => setApproval(selected.name, approved)}
          />
        ) : (
          <>
            {servers === null && <CardGridSkeleton />}
            {servers?.length === 0 && unlisted.length === 0 && !loadError && (
              <PageEmpty
                title="No MCP servers configured"
                hint="Add one with the + above, or list it in .mcp.json and reload."
              />
            )}
            {all.length > 0 && shown.length === 0 && <PageEmpty title="No MCP servers match" />}
            {shown.length > 0 && (
              <CardGrid>
                {shown.map((s) => (
                  <McpServerCard
                    key={s.name}
                    state={stateOf(s)}
                    busy={busy === s.name}
                    onOpen={() => open(s)}
                    onToggle={() => toggle(s)}
                    onApprove={() => setApproval(s.name, true)}
                  />
                ))}
              </CardGrid>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
