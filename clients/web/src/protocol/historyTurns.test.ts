import { describe, expect, it } from "vitest";
import { parseHistoryTurn } from "./historyTurns";

describe("parseHistoryTurn", () => {
  it("coerces strings with String(x ?? '')", () => {
    expect(parseHistoryTurn({ role: "user", content: 42, run_id: 7 })).toEqual({
      role: "user",
      content: "42",
      run_id: "7",
    });
    expect(parseHistoryTurn({ role: "assistant" })).toEqual({ role: "assistant", content: "", run_id: "" });
  });

  it("coerces numbers with Number(x) || 0", () => {
    expect(
      parseHistoryTurn({ role: "stats", input_tokens: "1000", output_tokens: "garbage", duration: null }),
    ).toEqual({
      role: "stats",
      run_id: "",
      input_tokens: 1000,
      output_tokens: 0,
      reasoning_tokens: 0,
      duration: 0,
    });
  });

  it("names a tool by friendly_name, else tool_name", () => {
    expect(parseHistoryTurn({ role: "tool", friendly_name: "Bash", tool_name: "run" })).toMatchObject({
      name: "Bash",
    });
    expect(parseHistoryTurn({ role: "tool", tool_name: "run" })).toMatchObject({ name: "run" });
    expect(parseHistoryTurn({ role: "tool", friendly_name: "", tool_name: "run" })).toMatchObject({ name: "" });
  });

  it("reads tool flags as booleans", () => {
    expect(parseHistoryTurn({ role: "tool", is_error: 1, is_rejected: 0 })).toMatchObject({
      is_error: true,
      is_rejected: false,
    });
  });

  it("defaults a visualization's source agent to 'visualizer'", () => {
    expect(parseHistoryTurn({ role: "visualization", spec_id: "s" })).toMatchObject({
      source_agent: "visualizer",
      title: "",
      extension_id: "",
    });
  });

  it("marks a role it does not render as unknown", () => {
    expect(parseHistoryTurn({ role: "system", content: "boot" })).toEqual({
      role: "unknown",
      wireRole: "system",
      run_id: "",
    });
    expect(parseHistoryTurn(null)).toMatchObject({ role: "unknown", wireRole: "" });
  });
});
