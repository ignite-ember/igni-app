/**
 * The Retry editor of a failed sub-agent: whether it is open, and the
 * tweaked task being written.
 *
 * Until the person types, the draft is the agent's task, read live, so a
 * task that arrives after the first render shows up. Once they type, the
 * draft is theirs, emptied textarea included.
 */

import { useState } from "react";

import type { OrchestrateAgent } from "../../chat/orchestrateAgentTree";

export interface RetryDraft {
  open: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  toggle: () => void;
  /** Closes the editor and forgets what was typed. */
  cancel: () => void;
  /** Sends the trimmed draft when it is not empty, and closes. */
  submit: (onRetry: (agentName: string, newTask: string) => void) => void;
}

export function useRetryDraft(agent: OrchestrateAgent): RetryDraft {
  const [retryOpen, setRetryOpen] = useState(false);
  /** ``null``: nothing typed yet, so the draft is ``agent.task``. */
  const [retryDraft, setRetryDraft] = useState<string | null>(null);
  const draft = retryDraft ?? agent.task;

  return {
    open: retryOpen,
    draft,
    setDraft: setRetryDraft,
    toggle: () => setRetryOpen((v) => !v),
    cancel: () => {
      setRetryOpen(false);
      setRetryDraft(null);
    },
    submit: (onRetry) => {
      const task = draft.trim();
      if (!task) return;
      onRetry(agent.name, task);
      setRetryOpen(false);
    },
  };
}
