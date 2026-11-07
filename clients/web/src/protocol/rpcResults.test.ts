import { describe, expect, it } from "vitest";

import {
  AttachSessionResult,
  CloudPlan,
  ContextTokenCount,
  HostModelReply,
  InterruptedRun,
  ListExtensionsResult,
  PendingLoopIteration,
  PickDirResult,
  RunWorkflowResult,
  ServiceTokenReply,
  SessionIdReply,
  TruncateHistoryResult,
  VisualizationActionResult,
} from "./rpcResults";

describe("RPC results", () => {
  it("reads attach_session", () => {
    expect(AttachSessionResult.parse({ session_id: "s", project_dir: "/p" })).toEqual(
      new AttachSessionResult("s", "/p"),
    );
    expect(AttachSessionResult.parse(null)).toEqual(new AttachSessionResult("", ""));
  });

  it("reads get_cloud_plan", () => {
    expect(CloudPlan.parse({ full_name: "Ada" }).fullName).toBe("Ada");
    expect(CloudPlan.parse(null).fullName).toBe("");
  });

  it("reads pick_dir_native", () => {
    expect(PickDirResult.parse({ path: "/x", cancelled: false, error: "" })).toEqual(
      new PickDirResult("/x", false, ""),
    );
    expect(PickDirResult.parse({ cancelled: true }).cancelled).toBe(true);
  });

  it("reads host_model, keeping only what was sent", () => {
    expect(HostModelReply.parse({ ok: true, result: 3 })).toEqual({ ok: true, result: 3 });
    expect(HostModelReply.parse({ ok: false, error: { code: "denied", message: "no" } })).toEqual({
      ok: false,
      error: { code: "denied", message: "no" },
    });
  });

  it("reads extension_service_token into the frame's shape", () => {
    expect(ServiceTokenReply.parse({ ok: true, access_token: "t", expires_in: 60 })).toEqual({
      ok: true,
      token: "t",
      expiresIn: 60,
      error: undefined,
    });
  });

  it("reads run_workflow", () => {
    expect(RunWorkflowResult.parse({ workflow_run_id: "wf1", name: "build" })).toEqual(
      new RunWorkflowResult("wf1", "build"),
    );
  });

  it("reads list_extensions, dropping entries without an id", () => {
    const result = ListExtensionsResult.parse({
      extensions: [
        { id: "kb", name: "Knowledge", pages: [{ kind: "kb", label: "KB", sidebar: true, entry: "/" }], extra: 1 },
        { name: "no id" },
        "junk",
      ],
    });
    expect(result.extensions).toHaveLength(1);
    const [kb] = result.extensions;
    expect(kb).toMatchObject({ id: "kb", name: "Knowledge", menu: [], indicators: [], values: {} });
    expect(kb.pages).toEqual([{ kind: "kb", label: "KB", sidebar: true, entry: "/" }]);
    expect(ListExtensionsResult.parse(undefined).extensions).toEqual([]);
  });
});

describe("RPC results the chat shell reads", () => {
  it("reads get_session_id", () => {
    expect(SessionIdReply.parse("abc")).toBe("abc");
    expect(SessionIdReply.parse(null)).toBe("");
  });

  it("reads count_context_tokens", () => {
    expect(ContextTokenCount.parse(1200)).toBe(1200);
    expect(ContextTokenCount.parse(0)).toBe(0);
    expect(ContextTokenCount.parse("12")).toBe(0);
  });

  it("reads truncate_history", () => {
    expect(TruncateHistoryResult.parse({ removed: 2 })).toEqual(new TruncateHistoryResult(2, ""));
    expect(TruncateHistoryResult.parse({ error: "no such run" }).error).toBe("no such run");
    expect(TruncateHistoryResult.parse(null)).toEqual(new TruncateHistoryResult(0, ""));
  });

  it("reads pop_pending_loop_iteration", () => {
    expect(PendingLoopIteration.parse({ prompt: "again" }).prompt).toBe("again");
    expect(PendingLoopIteration.parse(null).prompt).toBe("");
  });

  it("reads get_interrupted_runs, dropping rows without a message id", () => {
    expect(
      InterruptedRun.parseList([
        { message_id: "m1", content: "hi" },
        { content: "orphan" },
        "junk",
      ]),
    ).toEqual([new InterruptedRun("m1", "hi")]);
    expect(InterruptedRun.parseList({})).toEqual([]);
  });

  it("reads dispatch_visualization_action", () => {
    expect(
      VisualizationActionResult.parse({ ok: true, action: "pick", params: { a: 1 } }),
    ).toEqual(new VisualizationActionResult(true, "pick", { a: 1 }));
    expect(VisualizationActionResult.parse(null).ok).toBe(false);
  });
});
