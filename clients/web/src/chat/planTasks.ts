/**
 * The structured checklist of a submitted plan: the agent's
 * ``exit_plan_mode(tasks=[...])``, kept current by ``todos_updated``.
 */

import { WirePayload } from "../protocol/wirePayload";

/** ``activeForm`` is the gerund shown while the task is in progress
 *  ("Running tests" for "Run tests"). */
export interface PlanTask {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

const STATUSES = ["pending", "in_progress", "completed"] as const;

export class PlanTaskList {
  constructor(readonly tasks: PlanTask[]) {}

  /** One untrusted task, or ``null`` when it has no content. An
   *  unknown status reads as ``pending``. */
  static parseTask(raw: unknown): PlanTask | null {
    if (!WirePayload.isRecord(raw)) return null;
    const p = new WirePayload(raw);
    const content = p.text("content").trim();
    if (!content) return null;
    return {
      content,
      status: p.oneOf("status", STATUSES, "pending"),
      activeForm: p.text("activeForm").trim(),
    };
  }

  /** Every task that parses; anything that is not a list is empty. */
  static parse(raw: unknown): PlanTaskList {
    if (!Array.isArray(raw)) return new PlanTaskList([]);
    const tasks: PlanTask[] = [];
    for (const t of raw) {
      const task = PlanTaskList.parseTask(t);
      if (task) tasks.push(task);
    }
    return new PlanTaskList(tasks);
  }

  /**
   * Fold a ``todos_updated`` snapshot in, matching by ``content``.
   *
   * The card reflects the plan the user approved, so todos that are
   * not in it are not added, and tasks missing from the snapshot keep
   * their last status. An empty ``activeForm`` never erases one.
   */
  mergeTodos(raw: unknown): PlanTaskList {
    if (this.tasks.length === 0) return this;
    const fresh = PlanTaskList.parse(raw).tasks;
    if (fresh.length === 0) return this;
    const byContent = new Map(fresh.map((t) => [t.content, t]));
    return new PlanTaskList(
      this.tasks.map((task) => {
        const match = byContent.get(task.content);
        if (!match) return task;
        return { ...task, status: match.status, activeForm: match.activeForm || task.activeForm };
      }),
    );
  }
}
