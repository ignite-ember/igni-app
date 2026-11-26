import { describe, expect, it } from "vitest";

import { parseTerminalEvent } from "./terminalWire";

const push = (channel: string, payload: unknown) =>
  parseTerminalEvent({ type: "push_notification", channel, payload } as never);

describe("parseTerminalEvent", () => {
  it("reads output and an exit", () => {
    expect(push("terminal_output", { terminal_id: "t", data: "x" })).toEqual({
      channel: "terminal_output",
      terminalId: "t",
      data: "x",
    });
    expect(push("terminal_exited", { terminal_id: "t", exit_code: 2 })).toEqual({
      channel: "terminal_exited",
      terminalId: "t",
      exitCode: 2,
    });
    expect(push("terminal_exited", { terminal_id: "t", exit_code: null })).toMatchObject({ exitCode: null });
  });

  it("ignores other channels, other messages and payloads naming no terminal", () => {
    expect(push("process_line", { terminal_id: "t" })).toBeNull();
    expect(push("terminal_output", { data: "x" })).toBeNull();
    expect(push("terminal_output", null)).toBeNull();
    expect(parseTerminalEvent({ type: "status_update" } as never)).toBeNull();
  });
});
