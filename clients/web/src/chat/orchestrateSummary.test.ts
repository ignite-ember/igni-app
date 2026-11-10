import { describe, expect, it } from "vitest";
import type { OrchestrateItem } from "./chatItem";
import type { OrchestrateAgent, OrchestrateToolCall } from "./orchestrateAgentTree";
import { AgentSummary, TeamSummary } from "./orchestrateSummary";

function agent(path: string, overrides: Partial<OrchestrateAgent> = {}): OrchestrateAgent {
  return {
    path,
    name: path,
    parent: null,
    status: "done",
    runId: "",
    task: "",
    previewLines: [],
    tools: [],
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    ...overrides,
  };
}

function tool(id: number, status: OrchestrateToolCall["status"]): OrchestrateToolCall {
  return { id, tool: "Read", args: "", status, result: "" };
}

function card(agents: OrchestrateAgent[], order = agents.map((a) => a.path)): OrchestrateItem {
  return {
    kind: "orchestrate",
    id: 1,
    cardId: "c1",
    agents: Object.fromEntries(agents.map((a) => [a.path, a])),
    order,
    streaming: false,
  };
}

describe("AgentSummary", () => {
  it("is active while running or paused", () => {
    expect(AgentSummary.of(agent("a", { status: "running" })).isActive).toBe(true);
    expect(AgentSummary.of(agent("a", { status: "paused" })).isActive).toBe(true);
    expect(AgentSummary.of(agent("a", { status: "done" })).isActive).toBe(false);
    expect(AgentSummary.of(agent("a", { status: "error" })).isActive).toBe(false);
  });

  it("is retriable only once it errored", () => {
    expect(AgentSummary.of(agent("a", { status: "error" })).isRetriable).toBe(true);
    expect(AgentSummary.of(agent("a", { status: "done" })).isRetriable).toBe(false);
    expect(AgentSummary.of(agent("a", { status: "running" })).isRetriable).toBe(false);
  });

  it("counts its tools by status", () => {
    const tools = [tool(1, "running"), tool(2, "done"), tool(3, "done"), tool(4, "error")];
    expect(AgentSummary.of(agent("a", { tools })).toolCounts).toEqual({
      running: 1,
      done: 2,
      error: 1,
      total: 4,
    });
  });

  it("reports its tokens", () => {
    const a = agent("a", { inputTokens: 10, outputTokens: 5, reasoningTokens: 2 });
    expect(AgentSummary.of(a).tokens).toEqual({ input: 10, output: 5, reasoning: 2 });
  });
});

describe("TeamSummary", () => {
  it("lists the agents in spawn order and skips paths with no agent", () => {
    const team = TeamSummary.of(card([agent("a"), agent("b")], ["b", "missing", "a"]));
    expect(team.agents.map((a) => a.path)).toEqual(["b", "a"]);
    expect(team.agentCount).toBe(2);
  });

  it("counts running and paused agents as running, and streams while any is", () => {
    const team = TeamSummary.of(
      card([agent("a", { status: "running" }), agent("b", { status: "paused" }), agent("c")]),
    );
    expect(team.runningCount).toBe(2);
    expect(team.isStreaming).toBe(true);
    expect(TeamSummary.of(card([agent("a"), agent("b", { status: "error" })])).isStreaming).toBe(false);
  });

  it("sums tools and tokens across agents", () => {
    const team = TeamSummary.of(
      card([
        agent("a", { tools: [tool(1, "done")], inputTokens: 100, outputTokens: 10, reasoningTokens: 1 }),
        agent("b", { tools: [tool(2, "done"), tool(3, "error")], inputTokens: 50, outputTokens: 5 }),
      ]),
    );
    expect(team.totalTools).toBe(3);
    expect(team.tokens).toEqual({ input: 150, output: 15, reasoning: 1 });
  });

  it("previews the newest line of the latest agent that has one", () => {
    const team = TeamSummary.of(
      card([
        agent("a", { previewLines: ["a1", "a2"] }),
        agent("b", { previewLines: ["b1", "b2"] }),
        agent("c", { previewLines: [] }),
      ]),
    );
    expect(team.lastPreview).toBe("b2");
  });

  it("previews nothing for an empty team", () => {
    const team = TeamSummary.of(card([]));
    expect(team.lastPreview).toBe("");
    expect(team.agentCount).toBe(0);
    expect(team.isStreaming).toBe(false);
  });
});
