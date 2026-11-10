/** One sub-agent inside a team card: status, tool counts, tokens, its
 *  live preview, Stop / Retry, and its tool calls behind a chevron. */

import { useState } from "react";

import type { OrchestrateAgent } from "../../chat/orchestrateAgentTree";
import { AgentSummary } from "../../chat/orchestrateSummary";
import { ChevronIcon, RetryIcon, StopSquareIcon } from "../Icons";
import { formatTokenCount } from "../statsLine";
import { RetryEditor } from "./RetryEditor";
import { ToolCardView } from "./ToolCardView";
import { useRetryDraft } from "./useRetryDraft";

function ToolCountChips({ summary }: { summary: AgentSummary }) {
  const counts = summary.toolCounts;
  const tokens = summary.tokens;
  return (
    <span className="orch-agent-counts">
      {counts.running > 0 && (
        <span className="orch-count count-running" title={`${counts.running} running`}>
          {counts.running}
          <span className="orch-count-icon" aria-hidden="true">●</span>
        </span>
      )}
      {counts.done > 0 && (
        <span className="orch-count count-done" title={`${counts.done} done`}>
          {counts.done}
          <span className="orch-count-icon" aria-hidden="true">✓</span>
        </span>
      )}
      {counts.error > 0 && (
        <span className="orch-count count-error" title={`${counts.error} errored`}>
          {counts.error}
          <span className="orch-count-icon" aria-hidden="true">✗</span>
        </span>
      )}
      {counts.total === 0 && <span className="orch-count count-empty">no tools yet</span>}
      {(tokens.input > 0 || tokens.output > 0) && (
        <span
          className="orch-count count-tokens"
          title={`${tokens.input.toLocaleString()} in · ${tokens.output.toLocaleString()} out${tokens.reasoning ? ` · ${tokens.reasoning.toLocaleString()} reasoning` : ""}`}
        >
          ↓ {formatTokenCount(tokens.input)} · ↑ {formatTokenCount(tokens.output)}
        </span>
      )}
    </span>
  );
}

function PreviewWindow({ lines }: { lines: string[] }) {
  return (
    <div className="orch-agent-preview-window">
      {lines.map((line, i) => {
        const isLatest = i === lines.length - 1;
        return (
          <div key={i} className={`orch-preview-line${isLatest ? " latest" : ""}`} title={line}>
            <span className="orch-preview-glyph" aria-hidden="true">
              {isLatest ? "›" : "·"}
            </span>
            <span className="orch-preview-text">{line}</span>
          </div>
        );
      })}
    </div>
  );
}

export function OrchestrateAgentRow({
  agent,
  onStop,
  onRetry,
}: {
  agent: OrchestrateAgent;
  onStop?: (runId: string) => void;
  onRetry?: (agentName: string, newTask: string) => void;
}) {
  const summary = AgentSummary.of(agent);
  // Open while the agent works so its tools show live; closed once it
  // has finished. A click overrides either way.
  const [open, setOpen] = useState(summary.isActive);
  const retry = useRetryDraft(agent);
  const canRetry = summary.isRetriable && onRetry;
  return (
    <section className={`orch-agent card status-${agent.status}`}>
      <div className="orch-agent-head" title={`${agent.path} — ${agent.status}`}>
        <button
          type="button"
          className={`orch-agent-chevron${open ? " open" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Collapse" : "Expand"}
        >
          <ChevronIcon size={10} />
        </button>
        <span className="orch-agent-id" onClick={() => setOpen((v) => !v)} role="button" tabIndex={0}>
          <span className={`orch-agent-dot status-${agent.status}`} />
          <span className="orch-agent-name">{agent.name}</span>
          <span className={`orch-agent-status status-${agent.status}`}>{agent.status}</span>
        </span>
        <ToolCountChips summary={summary} />
        {summary.isActive && onStop && agent.runId && (
          <button
            type="button"
            className="orch-stop-btn orch-stop-agent"
            title={`Stop ${agent.name} — siblings keep running`}
            onClick={(e) => {
              e.stopPropagation();
              onStop(agent.runId);
            }}
          >
            <StopSquareIcon />
            Stop
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            className="orch-retry-btn"
            title={`Retry ${agent.name} — tweak the prompt and try again`}
            onClick={(e) => {
              e.stopPropagation();
              retry.toggle();
            }}
          >
            <RetryIcon />
            Retry
          </button>
        )}
      </div>
      {retry.open && canRetry && <RetryEditor agent={agent} retry={retry} onRetry={canRetry} />}
      {agent.previewLines.length > 0 && <PreviewWindow lines={agent.previewLines} />}
      {/* Focusable: a scroll container that cannot be focused cannot be
          scrolled from the keyboard (axe's scrollable-region-focusable). */}
      {open && agent.tools.length > 0 && (
        <div className="orch-agent-body" tabIndex={0} role="group" aria-label="Tool calls">
          {agent.tools.map((t) => (
            <ToolCardView key={t.id} name={t.tool} args={t.args} status={t.status} result={t.result} />
          ))}
        </div>
      )}
    </section>
  );
}
