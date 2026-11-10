import { describe, expect, it, vi } from "vitest";

import { RunWorkflowResult } from "../protocol/rpcResults";
import { WorkflowLauncher } from "./workflowLauncher";

describe("WorkflowLauncher.parseCommand", () => {
  it("ignores anything that is not /workflows", () => {
    expect(WorkflowLauncher.parseCommand("/help")).toEqual({ kind: "none" });
    expect(WorkflowLauncher.parseCommand("/workflowsx")).toEqual({ kind: "none" });
  });

  it("reads a bare /workflows as the listing", () => {
    expect(WorkflowLauncher.parseCommand(" /workflows ")).toEqual({ kind: "list" });
  });

  it("reads a name, with and without JSON args", () => {
    expect(WorkflowLauncher.parseCommand("/workflows build")).toEqual({ kind: "run", name: "build", args: {} });
    expect(WorkflowLauncher.parseCommand('/workflows build {"a": 1}')).toEqual({
      kind: "run",
      name: "build",
      args: { a: 1 },
    });
  });

  it("says when the args are not JSON", () => {
    const cmd = WorkflowLauncher.parseCommand("/workflows build {nope}");
    expect(cmd.kind).toBe("invalid");
  });
});

describe("WorkflowLauncher.start", () => {
  it("runs in this window's session and answers with the run id", async () => {
    const rpc = vi.fn(async () => ({ workflow_run_id: "wf9", name: "build" }));
    const launcher = new WorkflowLauncher({ rpc, sessionId: "s1" } as never);
    await expect(launcher.start("build", { a: 1 })).resolves.toEqual(new RunWorkflowResult("wf9", "build"));
    expect(rpc).toHaveBeenCalledWith("run_workflow", { name: "build", args: { a: 1 }, session_id: "s1" });
  });
});
