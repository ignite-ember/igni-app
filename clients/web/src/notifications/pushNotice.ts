/**
 * The notification a project-level push becomes: its title, its body,
 * where clicking it goes and what the host gets back.
 *
 * Background processes and scheduled tasks are not tied to a place in
 * the conversation, so they are notified rather than written into the
 * chat. The text is built here and nowhere else.
 */

import type { BackgroundProcessDone, SchedulerEvent } from "../protocol/pushChannels";
import type { NotifyInput } from "./notifier";

/** How much of a background command the notification shows. */
export const CMD_PREVIEW_CHARS = 160;
/** How much of a scheduled task's result the notification shows. */
export const RESULT_PREVIEW_CHARS = 240;

const ELLIPSIS = "…";

export class PushNotice {
  constructor(
    readonly title: string,
    readonly body: string,
    readonly data: Record<string, unknown>,
    readonly target?: NotifyInput["target"],
  ) {}

  static backgroundProcessDone(ev: BackgroundProcessDone): PushNotice {
    const cmd =
      ev.cmd.length > CMD_PREVIEW_CHARS ? ev.cmd.slice(0, CMD_PREVIEW_CHARS - 1) + ELLIPSIS : ev.cmd;
    const duration =
      typeof ev.durationSeconds === "number" ? ` · ${ev.durationSeconds.toFixed(1)}s` : "";
    const title =
      ev.exitCode === 0
        ? `Background process finished${duration}`
        : `Background process failed (exit ${ev.exitCode})${duration}`;
    return new PushNotice(title, cmd, { channel: ev.channel });
  }

  static scheduler(ev: SchedulerEvent): PushNotice {
    const description = ev.description || "(no description)";
    const title =
      ev.channel === "scheduler_started" ? "Scheduled task started" : "Scheduled task completed";
    const result =
      ev.result.length > RESULT_PREVIEW_CHARS
        ? ev.result.slice(0, RESULT_PREVIEW_CHARS) + ELLIPSIS
        : ev.result;
    const body =
      ev.channel === "scheduler_completed" && result ? `${description}\n\n${result}` : description;
    return new PushNotice(
      title,
      body,
      { channel: ev.channel, task_id: ev.taskId },
      { kind: "schedule", label: "Scheduled tasks" },
    );
  }

  toNotify(): NotifyInput {
    return { title: this.title, body: this.body, target: this.target, data: this.data };
  }
}
