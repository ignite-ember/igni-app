import { describe, expect, it } from "vitest";
import { ListedProcess, ProcessTail, parseProcessEvent } from "./processWire";

const push = (channel: string, payload: Record<string, unknown>) =>
  parseProcessEvent({ type: "push_notification", channel, payload } as never);

describe("ListedProcess", () => {
  it("reads each entry and drops ones without a pid", () => {
    const listed = ListedProcess.parseList([
      { pid: 7, cmd: "make", elapsed_seconds: 3, is_running: true, exit_code: null },
      { cmd: "no pid" },
    ]);
    expect(listed).toEqual([new ListedProcess(7, "make", 3, true, null)]);
  });

  it("reads a list that is not an array as empty", () => {
    expect(ListedProcess.parseList(null)).toEqual([]);
  });
});

describe("ProcessTail", () => {
  it("splits the output into lines", () => {
    expect(ProcessTail.parse({ output: "a\nb", is_running: false, exit_code: 2 })).toEqual(
      new ProcessTail(["a", "b"], false, 2),
    );
  });

  it("has no lines for empty output", () => {
    expect(ProcessTail.parse({ output: "" }).lines).toEqual([]);
  });
});

describe("parseProcessEvent", () => {
  it("reads the three process channels", () => {
    expect(push("process_started", { pid: 1, cmd: "ls", started_at: 10 })).toEqual({
      channel: "process_started",
      pid: 1,
      cmd: "ls",
      startedAt: 10,
    });
    expect(push("process_line", { pid: 1, line: "hi" })).toEqual({ channel: "process_line", pid: 1, line: "hi" });
    expect(push("process_exited", { pid: 1, exit_code: 0 })).toEqual({
      channel: "process_exited",
      pid: 1,
      exitCode: 0,
    });
  });

  it("ignores other channels, other messages and payloads without a pid", () => {
    expect(push("file_edited", { pid: 1 })).toBeNull();
    expect(push("process_line", { line: "x" })).toBeNull();
    expect(parseProcessEvent({ type: "status" } as never)).toBeNull();
  });
});
