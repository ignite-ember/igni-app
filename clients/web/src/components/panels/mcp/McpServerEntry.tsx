/** One MCP server: its status line, its connect button, and what it offers when opened. */

import { useState, type ReactNode } from "react";
import { EntityGlyph } from "../../EntityGlyph";
import { ChevronIcon } from "../../Icons";
import { Button } from "../../page/Button";
import type { McpApproval } from "./mcpApproval";
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

/** Approve or Revoke beside the connect button, by the server's
 *  first-use approval; nothing for a server that needs none. */
function ApprovalButton({
  approval,
  name,
  busy,
  onApprove,
}: {
  approval: McpApproval | undefined;
  name: string;
  busy: boolean;
  onApprove: (approved: boolean) => void;
}) {
  if (approval?.waiting) {
    return (
      <Button variant="primary" size="sm" disabled={busy} label={`Approve ${name}`} onClick={() => onApprove(true)}>
        Approve
      </Button>
    );
  }
  if (approval?.revocable) {
    return (
      <Button
        size="sm"
        disabled={busy}
        label={`Revoke the approval of ${name}`}
        title="Withdraw the approval: the server is disconnected and does not connect again until approved"
        onClick={() => onApprove(false)}
      >
        Revoke
      </Button>
    );
  }
  return null;
}

export function McpServerEntry({
  server,
  approval,
  busy,
  onToggle,
  onToolToggle,
  onApprove,
}: {
  server: McpServer;
  /** Its first-use approval, when it needs one. */
  approval?: McpApproval;
  busy: boolean;
  onToggle: () => void;
  onToolToggle: (tool: string, enabled: boolean) => void;
  onApprove: (approved: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  // Refused until approved: no connecting, and the line says why.
  const waiting = approval?.waiting === true && !server.connected;
  // The dot: green when up, amber while waiting for approval, red when it
  // failed with a reason, and a quiet grey when it is simply off.
  const dot = waiting
    ? "running mcp-waiting"
    : { connected: "done", error: "error", idle: "mcp-idle" }[server.health];
  const heading = (
    <>
      <span className="name mcp-server-name">
        <span className={`tool-status ${dot}`} aria-hidden="true" />
        {server.name}
        <span className="meta">· {server.transport}</span>
        {server.expandable && (
          <span className={`tool-chevron mcp-server-chevron ${open ? "open" : ""}`}>
            <ChevronIcon />
          </span>
        )}
      </span>
      <span
        className="meta mcp-server-status"
        // The plain sentence is what the card says; the transport's own
        // words stay one hover away for whoever has to debug it.
        title={!waiting && server.error ? server.error : undefined}
      >
        {waiting && approval
          ? approval.waitingStatus
          : open && server.connected
            ? server.summary
            : server.status}
      </span>
    </>
  );
  return (
    <div className={`mcp-server${open ? " is-open" : ""}`}>
      <span className="entity-card-icon" aria-hidden="true">
        <EntityGlyph name={server.name} size={38} />
      </span>
      <div className="entity-card-body mcp-server-main">
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
        <div className="mcp-server-actions">
          <ApprovalButton approval={approval} name={server.name} busy={busy} onApprove={onApprove} />
          {!waiting && (
            <Button size="sm" disabled={busy || server.policyBlocked} onClick={onToggle}>
              {busy ? "…" : server.connected ? "Disconnect" : "Connect"}
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="mcp-server-body">
          <Section title="Tools" count={server.toolNames.length}>
            {server.toolNames.map((t) => (
              <ToolRow
                key={t}
                name={t}
                server={server.name}
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
    </div>
  );
}
