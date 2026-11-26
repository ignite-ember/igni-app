/** An agent's soft chips: where it comes from, and whether it can
 *  orchestrate other agents. */

import { agentPlugin, agentSource, SOURCE_LABELS, type AgentRow } from "./agentRecord";

export function AgentChips({ agent }: { agent: AgentRow }) {
  const source = agentSource(agent);
  const plugin = agentPlugin(agent);
  return (
    <span className="agent-chips">
      <span className={`agent-chip${source === "session" ? " is-unsaved" : ""}`}>
        {plugin ? `${SOURCE_LABELS.plugin} · ${plugin}` : SOURCE_LABELS[source]}
      </span>
      {agent.can_orchestrate && <span className="agent-chip">orchestrates</span>}
    </span>
  );
}
