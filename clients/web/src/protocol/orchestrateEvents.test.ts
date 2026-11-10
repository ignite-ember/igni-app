import { describe, expect, it } from "vitest";
import { parseOrchestrateEvent } from "./orchestrateEvents";

describe("parseOrchestrateEvent", () => {
  it("reads the card id and the typed event", () => {
    expect(
      parseOrchestrateEvent({ type: "agent_started", agent_path: "qa", agent: "qa", card_id: "c1" }),
    ).toEqual({
      cardId: "c1",
      event: { type: "agent_started", agent_path: "qa", agent: "qa", parent: null, run_id: undefined, task: undefined },
    });
  });

  it("gives an event without a card id an empty one", () => {
    expect(parseOrchestrateEvent({ type: "content_preview", agent_path: "p", text: "x" })?.cardId).toBe("");
  });

  it("drops an empty tool_call_id", () => {
    expect(
      parseOrchestrateEvent({ type: "tool_started", agent_path: "p", tool: "rg", tool_call_id: "", args: "" })
        ?.event,
    ).toMatchObject({ tool_call_id: undefined });
  });

  it("is null for a visualization delta, an unknown type, or no agent_path", () => {
    expect(parseOrchestrateEvent({ type: "visualization_delta", spec_id: "s", json: "{}" })).toBeNull();
    expect(parseOrchestrateEvent({ type: "brand_new", agent_path: "p" })).toBeNull();
    expect(parseOrchestrateEvent({ type: "agent_started", agent: "qa" })).toBeNull();
    expect(parseOrchestrateEvent(null)).toBeNull();
  });
});
