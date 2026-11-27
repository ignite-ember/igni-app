/** One scheduled task's own page: what it asks, when it runs, and all of
 *  what its last run said — however long. */

import { useState } from "react";

import type { IgniClient } from "../../../protocol/client";
import { ClockIcon, XIcon } from "../../Icons";
import { PlainMarkdown } from "../../markdown/PlainMarkdown";
import { Button } from "../../page/Button";
import { PlayGlyph } from "../../page/CardAction";
import { DetailFacts } from "../../page/DetailFacts";
import { DetailMarkdown } from "../../page/DetailMarkdown";
import { DetailSection } from "../../page/DetailSection";
import { EntityHero } from "../../page/EntityHero";
import { HeroChip } from "../../page/HeroChip";
import { CopyTextButton, MonoBlock } from "../MonoBlock";
import { formatWhen, isLive, looksLikeMarkdown, taskName, whenLabel, type ScheduledTask } from "./scheduleView";

/** The fact a task's time is: still to come, past, or never reached. */
function whenFact(status: string): string {
  if (isLive(status)) return "Next run";
  return status === "cancelled" ? "Was due" : "Last run";
}

interface RunResult {
  run_id?: string;
  result?: string;
}

/** A run's answer or a task's result: markdown when it is, else mono. */
function Output({ text }: { text: string }) {
  return looksLikeMarkdown(text) ? (
    <DetailMarkdown>
      <PlainMarkdown text={text} />
    </DetailMarkdown>
  ) : (
    <MonoBlock text={text} label="Output" />
  );
}

export function TaskDetail({
  task,
  client,
  onCancel,
}: {
  task: ScheduledTask;
  client: IgniClient;
  onCancel: () => Promise<void>;
}) {
  const [running, setRunning] = useState(false);
  const [runAnswer, setRunAnswer] = useState<string | null>(null);
  const [runError, setRunError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const status = task.status || "pending";
  const live = isLive(status);
  const result = task.result ?? "";
  const error = task.error ?? "";

  const runNow = async () => {
    if (!task.description) return;
    setRunning(true);
    setRunError("");
    try {
      const r = await client.rpc<RunResult>("execute_scheduled_task", { description: task.description });
      setRunAnswer(r?.result ?? "");
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="entity-detail task-detail">
      <EntityHero
        name={taskName(task)}
        icon={
          <span className="entity-glyph" style={{ width: 52, height: 52 }}>
            <ClockIcon size={22} />
          </span>
        }
        meta={
          <>
            <span className="entity-meta">{task.recurrence || "once"}</span>
            {task.scheduled_at && (
              <span className="entity-meta">
                {whenLabel(status)} {formatWhen(task.scheduled_at)}
              </span>
            )}
          </>
        }
        chips={<HeroChip>{status}</HeroChip>}
        actions={
          <>
            <Button
              variant="primary"
              icon={<PlayGlyph size={10} />}
              busy={running}
              disabled={!task.description}
              onClick={() => void runNow()}
              title="Run what this task asks, now, in this session"
            >
              Run now
            </Button>
            {live && task.id && (
              <Button variant="danger" icon={<XIcon size={11} />} busy={cancelling} onClick={() => void cancel()}>
                Cancel
              </Button>
            )}
          </>
        }
      />
      <DetailSection title="Task">
        <DetailFacts
          facts={[
            !!task.id && { label: "ID", value: task.id, mono: true },
            { label: "Schedule", value: task.recurrence || "Once" },
            !!task.scheduled_at && { label: whenFact(status), value: formatWhen(task.scheduled_at) },
            !!task.created_at && { label: "Created", value: formatWhen(task.created_at) },
          ]}
        />
      </DetailSection>
      {(running || runAnswer !== null || runError) && (
        <DetailSection
          title="Run now"
          actions={runAnswer ? <CopyTextButton text={runAnswer} label="Copy the run's answer" /> : undefined}
        >
          {running && <p className="detail-note">Running…</p>}
          {runError && <MonoBlock text={runError} tone="danger" label="Run error" />}
          {!running && runAnswer !== null && (runAnswer ? <Output text={runAnswer} /> : <p className="detail-note">The run said nothing.</p>)}
        </DetailSection>
      )}
      {error && (
        <DetailSection title="Error" actions={<CopyTextButton text={error} label="Copy the error" />}>
          <MonoBlock text={error} tone="danger" label="Error" />
        </DetailSection>
      )}
      {result ? (
        <DetailSection title="Output" actions={<CopyTextButton text={result} label="Copy the output" />}>
          <Output text={result} />
        </DetailSection>
      ) : (
        !error && (
          <DetailSection title="Output">
            <p className="detail-note">
              {status === "cancelled" ? "Cancelled before it ran." : "No output yet — this task hasn't run."}
            </p>
          </DetailSection>
        )
      )}
    </div>
  );
}
