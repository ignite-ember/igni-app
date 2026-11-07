import { describe, expect, it } from "vitest";
import { parseWorkflowEvent } from "./workflowEvents";

const envelope = { workflow_run_id: "wf_1", name: "smoke", ts: 10, seq: 2 };
const parse = (type: string, payload: unknown) => parseWorkflowEvent({ ...envelope, type, payload });

describe("parseWorkflowEvent", () => {
  it("rejects anything without a string workflow_run_id and type", () => {
    expect(parseWorkflowEvent(null)).toBeNull();
    expect(parseWorkflowEvent("x")).toBeNull();
    expect(parseWorkflowEvent({ ...envelope, workflow_run_id: 7, type: "log" })).toBeNull();
    expect(parseWorkflowEvent({ ...envelope })).toBeNull();
  });

  it("keeps the envelope", () => {
    expect(parse("parallel_completed", {})).toMatchObject(envelope);
  });

  it("keeps an unknown type on the tape as unrecognized", () => {
    expect(parse("log", { text: "hi" })).toMatchObject({
      type: "unrecognized",
      wireType: "log",
      payload: { text: "hi" },
    });
  });

  it("defaults a phase without a string title to '(unnamed phase)'", () => {
    expect(parse("phase_started", { phase_id: "p1", title: 3 })).toMatchObject({
      payload: { phase_id: "p1", title: "(unnamed phase)" },
    });
  });

  it("defaults an agent without a string label to 'agent'", () => {
    expect(parse("agent_started", { id: "a1" })).toMatchObject({
      payload: { id: "a1", label: "agent" },
    });
  });

  it("defaults a missing or unknown completion status to 'completed'", () => {
    expect(parse("phase_completed", { phase_id: "p1" })).toMatchObject({ payload: { status: "completed" } });
    expect(parse("agent_completed", { id: "a1", status: "weird" })).toMatchObject({
      payload: { status: "completed" },
    });
    expect(parse("workflow_completed", { status: "cancelled" })).toMatchObject({
      payload: { status: "cancelled" },
    });
  });

  it("defaults a failure without a string error to 'workflow failed'", () => {
    expect(parse("workflow_failed", { error: 5 })).toMatchObject({
      payload: { error: "workflow failed", status: "failed" },
    });
  });

  it("keeps workflow_started args only when they are a plain object", () => {
    expect(parse("workflow_started", { args: { a: 1 } })).toMatchObject({ payload: { args: { a: 1 } } });
    expect(parse("workflow_started", { args: [1] })).toMatchObject({ payload: { args: undefined } });
  });

  it("treats a missing payload as empty", () => {
    expect(parse("agent_started", undefined)).toMatchObject({ payload: { id: "", label: "agent" } });
  });
});
