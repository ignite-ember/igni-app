/** The agents as a grid of cards: each opens the agent's page, and an
 *  unsaved one carries its keep and discard actions. */

import { CardGrid } from "../../page/CardGrid";
import { CardGridSkeleton } from "../../page/CardGridSkeleton";
import { EntityCard } from "../../page/EntityCard";
import { PageEmpty } from "../../page/PageEmpty";
import { AgentChips } from "./AgentChips";
import { AgentKeepActions, type KeepChoice } from "./AgentKeepActions";
import { agentShortName, toolsSummary, type AgentRow } from "./agentRecord";

export function AgentsList({
  agents,
  visible,
  busy,
  onOpen,
  onKeep,
}: {
  /** Every agent, or `null` while the first read is in flight. */
  agents: AgentRow[] | null;
  /** The ones the search and filter leave. */
  visible: AgentRow[];
  /** The agent an action is running on, or "". */
  busy: string;
  onOpen: (agent: AgentRow) => void;
  onKeep: (agent: AgentRow, choice: KeepChoice) => void;
}) {
  if (agents === null) return <CardGridSkeleton />;
  if (agents.length === 0) {
    return (
      <PageEmpty
        title="No agents yet"
        hint="Add a Markdown definition under .igni/agents/ in your project, or install a plugin that ships agents."
      />
    );
  }
  if (visible.length === 0) {
    return <PageEmpty title="No agents match" hint="Try another search or source." />;
  }
  return (
    <CardGrid>
      {visible.map((a) => (
        <EntityCard
          key={a.name}
          className="agent-card"
          name={a.name || "Agent"}
          glyph={agentShortName(a) || "Agent"}
          label={a.name || "Agent"}
          onOpen={() => onOpen(a)}
          action={
            a.is_ephemeral ? (
              <AgentKeepActions
                variant="icons"
                busy={busy === a.name}
                onPick={(choice) => onKeep(a, choice)}
              />
            ) : undefined
          }
          description={a.description}
          chips={<AgentChips agent={a} />}
          footer={
            <>
              <span className="entity-meta">{a.model || "Default model"}</span>
              <span className="entity-meta">· {toolsSummary(a)}</span>
              {!!a.mcp_servers?.length && (
                <span className="entity-meta">
                  · {a.mcp_servers.length} MCP server{a.mcp_servers.length === 1 ? "" : "s"}
                </span>
              )}
            </>
          }
        />
      ))}
    </CardGrid>
  );
}
