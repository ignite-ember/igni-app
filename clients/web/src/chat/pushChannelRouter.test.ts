// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { StatusUpdate } from "../protocol/messages";
import { parsePushChannel } from "../protocol/pushChannels";
import type { ChatItem } from "./chatItem";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { ChatTranscript } from "./chatTranscript";
import { HttpRetryAttemptEvent, HttpRetrySucceededEvent } from "./httpRetryEvents";
import { PROGRESS_LINE_CHARS, PushChannelRouter } from "./pushChannelRouter";

function harness(initial: ChatItem[] = [], status: StatusUpdate | null = null) {
  const chatItems = new ChatItemFactory(new ChatItemIds());
  const state = { items: initial, status };
  const deps = {
    windowModel: { clientId: "w1", applyPush: vi.fn() },
    chatItems,
    transcript: (items: ChatItem[]) => new ChatTranscript(items, chatItems),
    setItems: vi.fn((next: ChatItem[] | ((prev: ChatItem[]) => ChatItem[])) => {
      state.items = typeof next === "function" ? next(state.items) : next;
    }),
    setStatus: vi.fn(
      (next: StatusUpdate | null | ((prev: StatusUpdate | null) => StatusUpdate | null)) => {
        state.status = typeof next === "function" ? next(state.status) : next;
      },
    ),
    notifier: { notify: vi.fn(async () => {}) },
    host: { openExternal: vi.fn(async () => true) },
    refreshSessions: vi.fn(async () => {}),
    events: { dispatchEvent: vi.fn((_ev: Event) => true) },
  };
  const router = new PushChannelRouter(deps);
  const route = (channel: string, payload: Record<string, unknown> = {}) => {
    const ev = parsePushChannel({ channel, payload });
    if (!ev) throw new Error(`${channel} did not parse`);
    router.route(ev);
  };
  return { deps, state, route, chatItems };
}

describe("PushChannelRouter", () => {
  it("notifies a finished background process", () => {
    const { deps, route } = harness();
    route("background_process_done", { cmd: "make", exit_code: 0 });
    expect(deps.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Background process finished", body: "make" }),
    );
  });

  it("notifies a scheduler event, linking the schedule page", () => {
    const { deps, route } = harness();
    route("scheduler_completed", { description: "d", result: "r", task_id: "t" });
    expect(deps.notifier.notify).toHaveBeenCalledWith({
      title: "Scheduled task completed",
      body: "d\n\nr",
      target: { kind: "schedule", label: "Scheduled tasks" },
      data: { channel: "scheduler_completed", task_id: "t" },
    });
  });

  it("opens an external link only for this window", () => {
    const { deps, route } = harness();
    route("open_external", { window: "w2", url: "https://a.example" });
    expect(deps.host.openExternal).not.toHaveBeenCalled();
    route("open_external", { window: "w1", url: "https://a.example" });
    expect(deps.host.openExternal).toHaveBeenCalledWith("https://a.example");
  });

  it("hands a window model change to the model", () => {
    const { deps, route } = harness();
    route("window_model_changed", { window: "w1", field: "route", value: [], rev: 2, token: "x" });
    expect(deps.windowModel.applyPush).toHaveBeenCalledWith(
      expect.objectContaining({ window: "w1", field: "route", rev: 2 }),
    );
  });

  it("does nothing with file_edited", () => {
    const { deps, route } = harness();
    route("file_edited");
    expect(deps.setItems).not.toHaveBeenCalled();
  });

  it("opens a visualization card from a delta", () => {
    const { state, route } = harness();
    route("orchestrate_event", { type: "visualization_delta", spec_id: "s1", json: '{"root":"r","elements":{"r":{"type":"Text","props":{"text":"x"}}}}' });
    expect(state.items.map((i) => i.kind)).toEqual(["visualization"]);
  });

  it("opens an orchestrate card from a tree event", () => {
    const { state, route } = harness();
    route("orchestrate_event", { card_id: "c1", type: "content_preview", agent_path: "root", text: "hi" });
    expect(state.items.map((i) => i.kind)).toEqual(["orchestrate"]);
  });

  it("opens a workflow card for an unknown run", () => {
    const { state, route } = harness();
    route("workflow_event", {
      workflow_run_id: "wf1",
      name: "w",
      type: "phase_started",
      ts: 1,
      seq: 1,
      payload: { phase_id: "p", title: "P" },
    });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].kind).toBe("workflow");
  });

  it("folds a progress line into a card, cut to length", () => {
    const { state, route } = harness();
    route("orchestrate_progress", { line: "x".repeat(PROGRESS_LINE_CHARS + 30) });
    expect(state.items.map((i) => i.kind)).toEqual(["orchestrate"]);
  });

  it("refreshes the sessions when one is named", () => {
    const { deps, route } = harness();
    route("session_named");
    expect(deps.refreshSessions).toHaveBeenCalledOnce();
  });

  it("patches the status mode, and says when the agent entered plan mode", () => {
    const { state, route } = harness([], { permission_mode: "default" } as StatusUpdate);
    route("permission_mode_changed", { mode: "acceptEdits" });
    expect(state.status?.permission_mode).toBe("acceptEdits");
    expect(state.items).toEqual([]);
    route("permission_mode_changed", { mode: "plan", source: "agent", reason: "risky" });
    expect(state.items).toMatchObject([{ kind: "info", text: "Agent entered plan mode — risky" }]);
  });

  it("dispatches the retry banner's events", () => {
    const { deps, route } = harness();
    route("http_retry_attempt", { attempt: 1, delay_seconds: 2, url: "u" });
    route("http_retry_succeeded");
    const [attempt, succeeded] = deps.events.dispatchEvent.mock.calls.map((c) => c[0]);
    expect(attempt).toBeInstanceOf(HttpRetryAttemptEvent);
    expect(attempt).toMatchObject({ attempt: 1, delaySeconds: 2, url: "u" });
    expect(succeeded).toBeInstanceOf(HttpRetrySucceededEvent);
  });

  it("appends a submitted plan, then flips it when decided", () => {
    const { state, route } = harness();
    route("plan_submitted", { plan: "do it", run_id: "r1" });
    expect(state.items).toMatchObject([{ kind: "plan", plan: "do it", runId: "r1", state: "pending" }]);
    route("plan_decided", { run_id: "r1", decision: "approved" });
    expect(state.items).toMatchObject([{ kind: "plan", state: "approved" }]);
  });

  it("merges todos into open plan cards", () => {
    const { state, route } = harness();
    route("plan_submitted", { plan: "p", run_id: "r", tasks: [{ content: "a", status: "pending" }] });
    route("todos_updated", { todos: [{ content: "a", status: "completed" }] });
    const plan = state.items[0];
    expect(plan.kind === "plan" && plan.tasks[0].status).toBe("completed");
  });
});
