import { describe, expect, it } from "vitest";

import { parsePushChannel } from "./pushChannels";

const parse = (channel: string, payload: Record<string, unknown>) =>
  parsePushChannel({ channel, payload });

describe("parsePushChannel", () => {
  it("ignores a channel this client does not act on", () => {
    expect(parse("something_new", { a: 1 })).toBeNull();
    expect(parse("toString", {})).toBeNull();
  });

  it("reads background_process_done", () => {
    expect(parse("background_process_done", { cmd: "make", exit_code: 2, duration_seconds: 1.5 })).toEqual({
      channel: "background_process_done",
      cmd: "make",
      exitCode: 2,
      durationSeconds: 1.5,
    });
    expect(parse("background_process_done", { exit_code: "0" })).toEqual({
      channel: "background_process_done",
      cmd: "",
      exitCode: undefined,
      durationSeconds: undefined,
    });
  });

  it("reads both scheduler channels", () => {
    expect(parse("scheduler_started", { description: "  nightly  ", task_id: "t1" })).toEqual({
      channel: "scheduler_started",
      description: "nightly",
      result: "",
      taskId: "t1",
    });
    expect(parse("scheduler_completed", { description: "x", result: " ok " })).toMatchObject({
      channel: "scheduler_completed",
      result: "ok",
    });
  });

  it("reads open_external", () => {
    expect(parse("open_external", { window: "w1", url: "https://a.example" })).toEqual({
      channel: "open_external",
      window: "w1",
      url: "https://a.example",
    });
    expect(parse("open_external", { window: 3 })).toEqual({ channel: "open_external", window: "", url: "" });
  });

  it("reads window_model_changed, and refuses one without a revision or a known field", () => {
    const ev = parse("window_model_changed", {
      window: "w1",
      field: "route",
      value: [],
      rev: 4,
      token: "w1#1",
    });
    expect(ev).toMatchObject({
      channel: "window_model_changed",
      change: { window: "w1", field: "route", value: [], rev: 4, token: "w1#1" },
    });
    expect(parse("window_model_changed", { window: "w1", field: "route", value: [] })).toBeNull();
    expect(parse("window_model_changed", { window: "w1", field: "nope", rev: 1 })).toBeNull();
    expect(parse("window_model_changed", { field: "route", rev: 1 })).toBeNull();
  });

  it("reads file_edited, session_named and http_retry_succeeded as bare signals", () => {
    expect(parse("file_edited", {})).toEqual({ channel: "file_edited" });
    expect(parse("session_named", {})).toEqual({ channel: "session_named" });
    expect(parse("http_retry_succeeded", {})).toEqual({ channel: "http_retry_succeeded" });
  });

  it("reads orchestrate_event as a visualization delta or a tree event", () => {
    const delta = parse("orchestrate_event", { type: "visualization_delta", spec_id: "s", json: "{}" });
    expect(delta).toMatchObject({ channel: "orchestrate_event", delta: { spec_id: "s", json: "{}" } });
    const tree = parse("orchestrate_event", {
      card_id: "c1",
      type: "content_preview",
      agent_path: "root",
      text: "hi",
    });
    expect(tree?.channel).toBe("orchestrate_event");
    expect(parse("orchestrate_event", { type: "nonsense" })).toBeNull();
  });

  it("reads workflow_event, and refuses one without a run id", () => {
    const ev = parse("workflow_event", {
      workflow_run_id: "wf1",
      name: "w",
      type: "phase_started",
      ts: 1,
      seq: 1,
      payload: { phase_id: "p", title: "P" },
    });
    expect(ev?.channel).toBe("workflow_event");
    expect(parse("workflow_event", {})).toBeNull();
  });

  it("reads orchestrate_progress, and drops a blank line", () => {
    expect(parse("orchestrate_progress", { line: " step " })).toEqual({
      channel: "orchestrate_progress",
      line: "step",
    });
    expect(parse("orchestrate_progress", { line: "  " })).toBeNull();
  });

  it("reads permission_mode_changed with its defaults", () => {
    expect(parse("permission_mode_changed", {})).toEqual({
      channel: "permission_mode_changed",
      mode: "default",
      source: "",
      reason: "",
    });
    expect(parse("permission_mode_changed", { mode: "plan", source: "agent", reason: " why " })).toEqual({
      channel: "permission_mode_changed",
      mode: "plan",
      source: "agent",
      reason: "why",
    });
  });

  it("reads http_retry_attempt", () => {
    expect(parse("http_retry_attempt", { attempt: 2, delay_seconds: 4, url: "u" })).toEqual({
      channel: "http_retry_attempt",
      attempt: 2,
      delaySeconds: 4,
      url: "u",
    });
  });

  it("reads plan_submitted, and drops an empty plan", () => {
    expect(
      parse("plan_submitted", { plan: " do it ", run_id: "r1", tasks: [{ content: "a", status: "pending" }] }),
    ).toEqual({
      channel: "plan_submitted",
      plan: "do it",
      runId: "r1",
      tasks: [{ content: "a", status: "pending", activeForm: "" }],
    });
    expect(parse("plan_submitted", { plan: "" })).toBeNull();
  });

  it("reads plan_decided, and refuses an unknown decision or a missing run", () => {
    expect(parse("plan_decided", { run_id: "r1", decision: "approved" })).toEqual({
      channel: "plan_decided",
      runId: "r1",
      decision: "approved",
    });
    expect(parse("plan_decided", { run_id: "r1", decision: "maybe" })).toBeNull();
    expect(parse("plan_decided", { decision: "dismissed" })).toBeNull();
  });

  it("reads todos_updated", () => {
    expect(parse("todos_updated", { todos: [1] })).toEqual({ channel: "todos_updated", todos: [1] });
  });

  it("reads host_signal, and refuses one with no extension or signal", () => {
    expect(
      parse("host_signal", {
        extension_id: "acme.one",
        signal: "chat.run_started",
        value: { run_id: "r1" },
      }),
    ).toEqual({
      channel: "host_signal",
      extensionId: "acme.one",
      signal: "chat.run_started",
      value: { run_id: "r1" },
    });
    expect(parse("host_signal", { signal: "chat.run_started" })).toBeNull();
    expect(parse("host_signal", { extension_id: "acme.one", signal: 3 })).toBeNull();
  });
});
