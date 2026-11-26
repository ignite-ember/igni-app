/** One MCP server's own page: its state and what to do about it, where
 *  it is configured, the tools it offers (each one shown to or hidden
 *  from the agent), its prompts and resources, and its last error. */

import { NamedIcon } from "../../Icons";
import { Button } from "../../page/Button";
import { DetailFacts } from "../../page/DetailFacts";
import { DetailSection } from "../../page/DetailSection";
import { EntityHero } from "../../page/EntityHero";
import { HeroChip } from "../../page/HeroChip";
import type { McpServerState } from "./mcpServerState";
import { McpStatusChip, PlugGlyph } from "./McpParts";
import { PromptRow, ResourceRow, ToolRow } from "./McpRows";

function Actions({
  state,
  busy,
  onToggle,
  onApprove,
}: {
  state: McpServerState;
  busy: boolean;
  onToggle: () => void;
  onApprove: (approved: boolean) => void;
}) {
  const name = state.server.name;
  const main = state.primaryAction;
  return (
    <>
      {main === "approve" && (
        <Button
          variant="primary"
          busy={busy}
          icon={<NamedIcon name="check" size={12} />}
          label={`Approve ${name}`}
          title="Approve the server and connect it"
          onClick={() => onApprove(true)}
        >
          Approve
        </Button>
      )}
      {(main === "connect" || main === "reconnect") && (
        <Button variant="primary" busy={busy} icon={<PlugGlyph />} onClick={onToggle}>
          {main === "reconnect" ? "Reconnect" : "Connect"}
        </Button>
      )}
      {main === "disconnect" && (
        <Button busy={busy} icon={<PlugGlyph off />} onClick={onToggle}>
          Disconnect
        </Button>
      )}
      {main === null && (
        <Button disabled title="An administrator policy forbids using this server">
          Connect
        </Button>
      )}
      {state.revocable && (
        <Button
          variant="danger"
          disabled={busy}
          label={`Revoke the approval of ${name}`}
          title="Withdraw the approval: the server is disconnected and does not connect again until approved"
          onClick={() => onApprove(false)}
        >
          Revoke approval
        </Button>
      )}
    </>
  );
}

export function McpServerDetail({
  state,
  busy,
  onToggle,
  onToolToggle,
  onApprove,
}: {
  state: McpServerState;
  busy: boolean;
  onToggle: () => void;
  onToolToggle: (tool: string, enabled: boolean) => void;
  onApprove: (approved: boolean) => void;
}) {
  const { server } = state;
  const tools = server.toolNames;
  const hidden = tools.filter((t) => server.isToolDisabled(t)).length;
  return (
    <div className="entity-detail mcp-detail">
      <EntityHero
        name={server.name}
        leading={<span className={`tool-status mcp-dot ${state.dot}`} aria-hidden="true" />}
        description={server.connected ? server.summary : state.sentence || undefined}
        chips={
          <>
            <McpStatusChip state={state} />
            <HeroChip>{server.transport}</HeroChip>
            {state.source && <HeroChip>{state.source}</HeroChip>}
          </>
        }
        actions={<Actions state={state} busy={busy} onToggle={onToggle} onApprove={onApprove} />}
      />

      {server.error && !state.waiting && (
        // The hero already says it plainly; this is the transport's own words.
        <DetailSection title="Last error">
          <pre className="mcp-detail-error">{server.error}</pre>
        </DetailSection>
      )}

      <DetailSection title="Configuration">
        <DetailFacts
          facts={[
            { label: "Status", value: state.label },
            { label: "Transport", value: server.transport },
            !!state.source && { label: "Scope", value: state.source },
            !!state.sourcePath && { label: "Config file", value: state.sourcePath, mono: true },
            state.approval && {
              label: "Approval",
              value: state.approval.approved
                ? state.revocable
                  ? "approved"
                  : "trusted (your own config)"
                : "waiting for your approval",
            },
          ]}
        />
      </DetailSection>

      <DetailSection title="Tools" count={tools.length}>
        {tools.length > 0 ? (
          <>
            {hidden > 0 && (
              <p className="detail-note mcp-detail-note">
                {hidden} hidden from the agent — switch one on to let the agent use it.
              </p>
            )}
            <div className="mcp-tool-list">
              {tools.map((t) => (
                <ToolRow
                  key={t}
                  name={t}
                  server={server.name}
                  description={server.toolDescriptions[t]}
                  disabled={server.isToolDisabled(t)}
                  onToggle={(enabled) => onToolToggle(t, enabled)}
                />
              ))}
            </div>
          </>
        ) : (
          <p className="mcp-detail-text">
            {server.connected
              ? "This server offers no tools."
              : "Its tools are listed once the server is connected."}
          </p>
        )}
      </DetailSection>

      {server.prompts.length > 0 && (
        <DetailSection title="Prompts" count={server.prompts.length}>
          <div className="mcp-tool-list">
            {server.prompts.map((p) => (
              <PromptRow key={p.name} prompt={p} />
            ))}
          </div>
        </DetailSection>
      )}

      {server.resources.length > 0 && (
        <DetailSection title="Resources" count={server.resources.length}>
          <div className="mcp-tool-list">
            {server.resources.map((r) => (
              <ResourceRow key={r.uri} resource={r} />
            ))}
          </div>
        </DetailSection>
      )}
    </div>
  );
}
