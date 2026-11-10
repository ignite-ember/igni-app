/** The inline editor that retries a failed sub-agent with a tweaked task. */

import type { OrchestrateAgent } from "../../chat/orchestrateAgentTree";
import type { RetryDraft } from "./useRetryDraft";

export function RetryEditor({
  agent,
  retry,
  onRetry,
}: {
  agent: OrchestrateAgent;
  retry: RetryDraft;
  onRetry: (agentName: string, newTask: string) => void;
}) {
  return (
    <div className="orch-agent-retry">
      <label className="orch-retry-label">
        Retry <strong>{agent.name}</strong> with a tweaked prompt:
      </label>
      <textarea
        className="orch-retry-textarea"
        value={retry.draft}
        placeholder={
          agent.task
            ? "Edit the original task above…"
            : "Describe what you want this agent to do instead…"
        }
        rows={Math.min(8, Math.max(3, retry.draft.split("\n").length))}
        autoFocus
        onChange={(e) => retry.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            retry.cancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            retry.submit(onRetry);
          }
        }}
      />
      <div className="orch-retry-bar">
        <span className="orch-retry-hint">
          ⌘↵ to send · Esc to cancel — the main agent decides how to act on this.
        </span>
        <button className="btn btn-sm" onClick={retry.cancel}>
          Cancel
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={!retry.draft.trim()}
          onClick={() => retry.submit(onRetry)}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
