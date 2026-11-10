/**
 * A plan submitted through ``exit_plan_mode``, with Approve and Refine
 * while it is pending. Deciding hides the buttons but keeps the plan:
 * it is part of the conversation.
 */

import { memo } from "react";

import type { PlanItem } from "../../chat/chatItem";
import { PlanTaskList, type PlanTask } from "../../chat/planTasks";
import { PlainMarkdown } from "../markdown/PlainMarkdown";

function taskMarker(status: PlanTask["status"]): string {
  return status === "completed" ? "✓" : status === "in_progress" ? "●" : "○";
}

function PlanTasks({ tasks }: { tasks: PlanTask[] }) {
  return (
    <ul className="plan-card-tasks">
      {tasks.map((task, idx) => (
        <li key={`${task.content}-${idx}`} className={`plan-card-task plan-card-task--${task.status}`}>
          <span className="plan-card-task-marker" aria-hidden="true">
            {taskMarker(task.status)}
          </span>
          <span className="plan-card-task-text">{PlanTaskList.labelOf(task)}</span>
        </li>
      ))}
    </ul>
  );
}

export const PlanCard = memo(function PlanCard({
  item,
  onApprove,
  onReject,
}: {
  item: PlanItem;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
}) {
  const isFinal = item.state !== "pending";
  return (
    <div className={`plan-card plan-card--${item.state}`}>
      <div className="plan-card-head">
        <span className="plan-card-badge" aria-hidden="true">▤</span>
        <span className="plan-card-title">Plan ready for review</span>
      </div>
      <div className="plan-card-body">
        <PlainMarkdown text={item.plan} />
      </div>
      {item.tasks.length > 0 ? <PlanTasks tasks={item.tasks} /> : null}
      <div className="plan-card-actions">
        {item.state === "pending" ? (
          <>
            <button
              type="button"
              className="plan-card-btn plan-card-btn--approve"
              onClick={() => onApprove(item.id)}
              title="Exit plan mode and let the agent execute this plan."
            >
              Approve &amp; exit plan mode
            </button>
            <button
              type="button"
              className="plan-card-btn plan-card-btn--reject"
              onClick={() => onReject(item.id)}
              title="Dismiss this plan. Stay in plan mode — type your feedback to ask for revisions."
            >
              Refine
            </button>
          </>
        ) : (
          <span className={`plan-card-footer plan-card-footer--${item.state}`} aria-live="polite">
            {item.state === "approved" ? "Plan approved — plan mode exited." : "Plan dismissed."}
          </span>
        )}
      </div>
      {isFinal ? null : (
        <div className="plan-card-hint">
          The agent is paused. Approve to exit plan mode and execute, or refine to keep iterating.
        </div>
      )}
    </div>
  );
});
