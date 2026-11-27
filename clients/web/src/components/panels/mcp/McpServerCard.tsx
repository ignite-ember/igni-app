/** One MCP server on the list: the shared card, opening the server's own
 *  page; its one quick action (approve, connect or disconnect) at the top
 *  right. */

import { countOf } from "../../../lib/plural";
import { NamedIcon } from "../../Icons";
import { CardAction } from "../../page/CardAction";
import { EntityCard } from "../../page/EntityCard";
import { HeroChip } from "../../page/HeroChip";
import type { McpServerState } from "./mcpServerState";
import { McpStatusChip, PlugGlyph } from "./McpParts";

export function McpServerCard({
  state,
  busy,
  onOpen,
  onToggle,
  onApprove,
}: {
  state: McpServerState;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onApprove: () => void;
}) {
  const { server } = state;
  const name = server.name;
  const action = state.waiting ? (
    <CardAction label={`Approve ${name}`} busy={busy} onClick={onApprove}>
      <NamedIcon name="check" size={13} />
    </CardAction>
  ) : (
    <CardAction
      label={server.connected ? `Disconnect ${name}` : `Connect ${name}`}
      title={server.policyBlocked ? "An administrator policy forbids using this server" : undefined}
      busy={busy}
      disabled={server.policyBlocked}
      onClick={onToggle}
    >
      <PlugGlyph off={server.connected} />
    </CardAction>
  );
  const offers = server.connected || server.toolNames.length > 0;
  return (
    <EntityCard
      name={name}
      label={`Open ${name}`}
      onOpen={onOpen}
      action={action}
      description={
        state.sentence && (
          // The plain sentence is what the card says; the transport's own
          // words stay one hover away.
          <span title={state.kind === "failed" ? server.error : undefined}>{state.sentence}</span>
        )
      }
      chips={
        <>
          <McpStatusChip state={state} />
          <HeroChip>{server.transport}</HeroChip>
          {state.source && <HeroChip>{state.source}</HeroChip>}
        </>
      }
      footer={
        offers && (
          <>
            <span className="entity-meta">{countOf(server.toolNames.length, "tool")}</span>
            {server.prompts.length > 0 && (
              <span className="entity-meta">{countOf(server.prompts.length, "prompt")}</span>
            )}
            {server.resources.length > 0 && (
              <span className="entity-meta">{countOf(server.resources.length, "resource")}</span>
            )}
          </>
        )
      }
    />
  );
}
