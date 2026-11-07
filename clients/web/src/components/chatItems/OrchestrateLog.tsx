/** The live card of a team run: one row per spawned agent, under a
 *  header with the team's totals and a Stop button. */

import { memo, useState } from "react";

import type { OrchestrateItem } from "../../chat/chatItem";
import { TeamSummary } from "../../chat/orchestrateSummary";
import { ChevronIcon, StopSquareIcon } from "../Icons";
import { formatTokenCount } from "../statsLine";
import type { TeamHandlers } from "./handlers";
import { OrchestrateAgentRow } from "./OrchestrateAgentRow";

function TeamTotals({ team }: { team: TeamSummary }) {
  const { agentCount, runningCount, totalTools, tokens } = team;
  return (
    <span className="orch-totals">
      {agentCount} {agentCount === 1 ? "agent" : "agents"}
      {runningCount > 0 && <span className="orch-totals-running"> · {runningCount} running</span>}
      {totalTools > 0 && (
        <span className="orch-totals-tools">
          {" · "}
          {totalTools} {totalTools === 1 ? "tool" : "tools"}
        </span>
      )}
      {(tokens.input > 0 || tokens.output > 0) && (
        <span className="orch-totals-tokens">
          {" · "}↓ {formatTokenCount(tokens.input)} · ↑ {formatTokenCount(tokens.output)}
        </span>
      )}
    </span>
  );
}

export const OrchestrateLog = memo(function OrchestrateLog({
  item,
  handlers,
}: {
  item: OrchestrateItem;
  handlers?: TeamHandlers;
}) {
  const [open, setOpen] = useState(true);
  const team = TeamSummary.of(item);
  const streaming = team.isStreaming;
  const lastPreview = team.lastPreview;
  const stopTeam = handlers?.stopTeam;
  return (
    <div className={`orchestrate-log${open ? " open" : " collapsed"}${streaming ? " streaming" : ""}`}>
      <div className="orchestrate-head" title={open ? "Collapse team progress" : "Expand team progress"}>
        <button
          type="button"
          className={`orchestrate-head-toggle${open ? " open" : ""}`}
          onClick={() => setOpen((v) => !v)}
          title={open ? "Collapse" : "Expand"}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <ChevronIcon size={14} />
        </button>
        <span className="orchestrate-title">Team progress</span>
        {/* ``role="img"``: an aria-label on a bare span has nothing to
            attach to, and axe calls it prohibited. */}
        {streaming && <span className="orchestrate-spinner" role="img" aria-label="Running" />}
        <span className="orchestrate-meta" onClick={() => setOpen((v) => !v)} role="button" tabIndex={0}>
          <TeamTotals team={team} />
          {!open && lastPreview && (
            <span className="orch-totals-preview"> · {lastPreview.slice(0, 60)}</span>
          )}
        </span>
        {streaming && stopTeam && (
          <button
            type="button"
            className="orch-stop-btn orch-stop-team"
            title="Stop the team — cancels all running agents"
            onClick={(e) => {
              e.stopPropagation();
              stopTeam();
            }}
          >
            <StopSquareIcon />
            Stop team
          </button>
        )}
      </div>
      {open && (
        <div className="orchestrate-body">
          {team.agentCount === 0 ? (
            <div className="orchestrate-empty">Waiting for the team to spin up…</div>
          ) : (
            team.agents.map((a) => (
              <OrchestrateAgentRow
                key={a.path}
                agent={a}
                onStop={handlers?.stopAgent}
                onRetry={handlers?.retryAgent}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
});
