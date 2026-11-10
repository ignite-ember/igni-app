/** One MCP server: its status line, its connect button, and what it offers when opened. */

import { useState, type ReactNode } from "react";
import { ChevronIcon } from "../../Icons";
import type { McpServer } from "./mcpServer";
import { PromptRow, ResourceRow, ToolRow } from "./McpRows";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mcp-section">
      <div className="mcp-section-head">
        {title} <span className="mcp-section-count">{count}</span>
      </div>
      <div className="mcp-tool-list">{children}</div>
    </div>
  );
}

export function McpServerEntry({
  server,
  busy,
  onToggle,
  onToolToggle,
}: {
  server: McpServer;
  busy: boolean;
  onToggle: () => void;
  onToolToggle: (tool: string, enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const heading = (
    <>
      <span className="name">
        <span
          className={`tool-chevron mcp-server-chevron ${open ? "open" : ""}`}
        >
          {server.expandable ? <ChevronIcon /> : null}
        </span>{" "}
        <span
          className={`tool-status ${server.connected ? "done" : "error"}`}
        />{" "}
        {server.name} <span className="meta">· {server.transport}</span>
      </span>
      <span className="meta">{server.status}</span>
    </>
  );
  return (
    <div className="mcp-server">
      <div className="row mcp-server-row">
        {server.expandable ? (
          <button
            type="button"
            className="mcp-server-head"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {heading}
          </button>
        ) : (
          <div className="mcp-server-head">{heading}</div>
        )}
        <button
          className="btn btn-sm"
          disabled={busy || server.policyBlocked}
          onClick={onToggle}
        >
          {busy ? "…" : server.connected ? "Disconnect" : "Connect"}
        </button>
      </div>
      {open && (
        <div className="mcp-server-body">
          <Section title="Tools" count={server.toolNames.length}>
            {server.toolNames.map((t) => (
              <ToolRow
                key={t}
                name={t}
                description={server.toolDescriptions[t]}
                disabled={server.isToolDisabled(t)}
                onToggle={(enabled) => onToolToggle(t, enabled)}
              />
            ))}
          </Section>
          <Section title="Resources" count={server.resources.length}>
            {server.resources.map((r) => (
              <ResourceRow key={r.uri} resource={r} />
            ))}
          </Section>
          <Section title="Prompts" count={server.prompts.length}>
            {server.prompts.map((p) => (
              <PromptRow key={p.name} prompt={p} />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}
