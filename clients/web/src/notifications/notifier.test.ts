import { describe, expect, it, vi } from "vitest";

import { Notifier } from "./notifier";
import { CMD_PREVIEW_CHARS, PushNotice, RESULT_PREVIEW_CHARS } from "./pushNotice";

function fakes(delivered: boolean) {
  const windowModel = { toast: vi.fn(), dismissToast: vi.fn() };
  const host = { notify: vi.fn(async () => delivered) };
  return { windowModel, host, notifier: new Notifier(windowModel, host) };
}

describe("Notifier", () => {
  it("shows a toast as an info toast in the window model", () => {
    const { windowModel, notifier } = fakes(false);
    notifier.toast({ title: "Hi" });
    expect(windowModel.toast).toHaveBeenCalledWith({ text: "Hi", kind: "info", body: null, target: null });
  });

  it("dismisses through the window model", () => {
    const { windowModel, notifier } = fakes(false);
    notifier.dismiss("t1");
    expect(windowModel.dismissToast).toHaveBeenCalledWith("t1");
  });

  it("leaves a notification to the host when it delivers one", async () => {
    const { windowModel, host, notifier } = fakes(true);
    await notifier.notify({ title: "T", body: "B", data: { a: 1 } });
    expect(host.notify).toHaveBeenCalledWith({ title: "T", body: "B", data: { a: 1 } });
    expect(windowModel.toast).not.toHaveBeenCalled();
  });

  it("falls back to a toast, with its target, when the host cannot", async () => {
    const { windowModel, notifier } = fakes(false);
    const target = { kind: "schedule", label: "Scheduled tasks" };
    await notifier.notify({ title: "T", body: "B", target });
    expect(windowModel.toast).toHaveBeenCalledWith({ text: "T", kind: "info", body: "B", target });
  });

  it("does not ping about a reply while there is no Notification API", () => {
    const { notifier } = fakes(false);
    expect(() => notifier.replyReady()).not.toThrow();
  });
});

describe("PushNotice", () => {
  it("says a background process finished, with its duration", () => {
    const n = PushNotice.backgroundProcessDone({
      channel: "background_process_done",
      cmd: "make",
      exitCode: 0,
      durationSeconds: 2,
    });
    expect(n.title).toBe("Background process finished · 2.0s");
    expect(n.body).toBe("make");
    expect(n.toNotify().data).toEqual({ channel: "background_process_done" });
  });

  it("says a background process failed, and cuts a long command", () => {
    const n = PushNotice.backgroundProcessDone({
      channel: "background_process_done",
      cmd: "x".repeat(CMD_PREVIEW_CHARS + 10),
      exitCode: 3,
    });
    expect(n.title).toBe("Background process failed (exit 3)");
    expect(n.body).toHaveLength(CMD_PREVIEW_CHARS);
    expect(n.body.endsWith("…")).toBe(true);
  });

  it("titles scheduler notices without an emoji and links the schedule", () => {
    const started = PushNotice.scheduler({
      channel: "scheduler_started",
      description: "",
      result: "",
      taskId: "t1",
    });
    expect(started.title).toBe("Scheduled task started");
    expect(started.body).toBe("(no description)");
    expect(started.target).toEqual({ kind: "schedule", label: "Scheduled tasks" });
    expect(started.data).toEqual({ channel: "scheduler_started", task_id: "t1" });
  });

  it("adds a completed task's result, cut to length", () => {
    const done = PushNotice.scheduler({
      channel: "scheduler_completed",
      description: "nightly",
      result: "r".repeat(RESULT_PREVIEW_CHARS + 1),
      taskId: undefined,
    });
    expect(done.title).toBe("Scheduled task completed");
    expect(done.body).toBe(`nightly\n\n${"r".repeat(RESULT_PREVIEW_CHARS)}…`);
  });
});
