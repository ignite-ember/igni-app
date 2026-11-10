/**
 * Read-only roll-ups of an orchestrate card, for its header and its
 * agent rows. Everything derives from each agent's ``status`` and its
 * tool calls; nothing here is stored.
 */

import type { OrchestrateItem } from "./chatItem";
import type { OrchestrateAgent } from "./orchestrateAgentTree";

export interface ToolCounts {
  running: number;
  done: number;
  error: number;
  total: number;
}

export interface TokenTotals {
  input: number;
  output: number;
  reasoning: number;
}

export class AgentSummary {
  private constructor(readonly agent: OrchestrateAgent) {}

  static of(agent: OrchestrateAgent): AgentSummary {
    return new AgentSummary(agent);
  }

  /** Still working: a paused agent is waiting, not finished. */
  get isActive(): boolean {
    return this.agent.status === "running" || this.agent.status === "paused";
  }

  /** Only a failed or stopped agent is worth retrying: a done one
   *  succeeded, an active one can be stopped instead. */
  get isRetriable(): boolean {
    return this.agent.status === "error";
  }

  get toolCounts(): ToolCounts {
    const { tools } = this.agent;
    const count = (status: OrchestrateAgent["tools"][number]["status"]) =>
      tools.filter((t) => t.status === status).length;
    return { running: count("running"), done: count("done"), error: count("error"), total: tools.length };
  }

  get tokens(): TokenTotals {
    return {
      input: this.agent.inputTokens,
      output: this.agent.outputTokens,
      reasoning: this.agent.reasoningTokens,
    };
  }
}

export class TeamSummary {
  private constructor(
    /** In the order the agents were spawned. */
    readonly agents: readonly OrchestrateAgent[],
  ) {}

  static of(item: OrchestrateItem): TeamSummary {
    return new TeamSummary(
      item.order.map((path) => item.agents[path]).filter((a): a is OrchestrateAgent => !!a),
    );
  }

  get agentCount(): number {
    return this.agents.length;
  }

  get runningCount(): number {
    return this.agents.filter((a) => AgentSummary.of(a).isActive).length;
  }

  /** From the agents themselves rather than the card's ``streaming``
   *  flag, which only clears on the top-level ``run_completed``: that
   *  never lands between consecutive spawns. */
  get isStreaming(): boolean {
    return this.runningCount > 0;
  }

  get totalTools(): number {
    return this.agents.reduce((n, a) => n + a.tools.length, 0);
  }

  get tokens(): TokenTotals {
    return this.agents.reduce<TokenTotals>(
      (sum, a) => ({
        input: sum.input + a.inputTokens,
        output: sum.output + a.outputTokens,
        reasoning: sum.reasoning + a.reasoningTokens,
      }),
      { input: 0, output: 0, reasoning: 0 },
    );
  }

  /** The newest preview line of the most recently spawned agent that has
   *  one; empty when none has. */
  get lastPreview(): string {
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const lines = this.agents[i].previewLines;
      const line = lines[lines.length - 1];
      if (line) return line;
    }
    return "";
  }
}
