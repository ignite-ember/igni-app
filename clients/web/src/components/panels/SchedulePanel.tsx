import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { IgniClient } from "../../protocol/client";
import { Drawer } from "./Drawer";
import { ClockIcon, XIcon } from "../Icons";
import { CardAction } from "../page/CardAction";
import { CardGrid } from "../page/CardGrid";
import { EntityCard } from "../page/EntityCard";
import { HeroChip } from "../page/HeroChip";
import { PageEmpty } from "../page/PageEmpty";
import { PageHeaderControls } from "../page/PageHeaderControls";
import { PageLoading } from "../page/PageLoading";
import { PageTabs } from "../page/PageTabs";

interface ScheduledTask {
  id?: string;
  description?: string;
  scheduled_at?: string;
  status?: string;
  recurrence?: string;
  result?: string;
  error?: string;
  created_at?: string;
}

const isLive = (s?: string) => s === "pending" || s === "running";

/** "Next run" while waiting, "Ran" once it has, "Was due" when cancelled first. */
function whenLabel(status: string): string {
  if (isLive(status)) return "Next run";
  return status === "cancelled" ? "Was due" : "Ran";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TaskCard({ task, onCancel }: { task: ScheduledTask; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(task.result || task.error);
  const status = task.status || "pending";
  return (
    <EntityCard
      className={`task-card${open ? " is-open" : ""}`}
      icon={
        <span className="entity-glyph task-glyph">
          <ClockIcon size={16} />
        </span>
      }
      // The name is the card's one toggle, stretched over the card so a
      // click anywhere opens it; Cancel stays its sibling, never nested.
      name={
        <button
          type="button"
          className="task-card-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {task.description || "(no description)"}
        </button>
      }
      action={
        isLive(status) && (
          <CardAction label="Cancel" title="Cancel this task" danger className="task-card-cancel" onClick={onCancel}>
            <XIcon size={11} />
          </CardAction>
        )
      }
      chips={<HeroChip>{status}</HeroChip>}
      footer={
        <>
          {task.recurrence && <span className="entity-meta">{task.recurrence}</span>}
          {task.scheduled_at && (
            <span className="entity-meta">
              {whenLabel(status)} {formatWhen(task.scheduled_at)}
            </span>
          )}
          {task.id && <span className="entity-meta">{task.id}</span>}
        </>
      }
    >
      {open && (
        <div className="task-card-body">
          {task.error && (
            <div className="task-block task-block-error">
              <div className="task-block-label">Error</div>
              <pre>{task.error}</pre>
            </div>
          )}
          {task.result && (
            <div className="task-block">
              <div className="task-block-label">Result</div>
              <div className="agent-prompt-md">
                <ReactMarkdown>{task.result}</ReactMarkdown>
              </div>
            </div>
          )}
          {!hasDetails && <div className="task-block-none">No output yet — this task hasn't run.</div>}
        </div>
      )}
    </EntityCard>
  );
}

type FilterKey = "active" | "all" | "completed" | "failed" | "cancelled";

const FILTERS: { key: FilterKey; label: string; empty: string; match: (s: string) => boolean }[] = [
  { key: "active", label: "Active", empty: "Nothing waiting to run", match: isLive },
  { key: "all", label: "All", empty: "No tasks", match: () => true },
  { key: "completed", label: "Done", empty: "Nothing has finished yet", match: (s) => s === "completed" },
  { key: "failed", label: "Failed", empty: "Nothing has failed", match: (s) => s === "failed" },
  { key: "cancelled", label: "Cancelled", empty: "Nothing cancelled", match: (s) => s === "cancelled" },
];

type SortKey = "live" | "soonest" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "live", label: "Waiting first" },
  { key: "soonest", label: "Soonest first" },
  { key: "name", label: "Name" },
];

const COMPARE: Record<SortKey, (a: ScheduledTask, b: ScheduledTask) => number> = {
  // Pending/running first, then the latest scheduled_at within each band.
  live: (a, b) => {
    const band = (s?: string) => (isLive(s) ? 0 : 1);
    return band(a.status) - band(b.status) || (b.scheduled_at || "").localeCompare(a.scheduled_at || "");
  },
  // A task with no time sinks to the bottom.
  soonest: (a, b) => (a.scheduled_at || "￿").localeCompare(b.scheduled_at || "￿"),
  name: (a, b) => (a.description || "").localeCompare(b.description || ""),
};

export function SchedulePanel({
  client,
  onClose,
}: {
  client: IgniClient;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [filter, setFilter] = useState<FilterKey>("active");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("live");

  const refresh = useCallback(async () => {
    try {
      // include_done so users can read past results (completed,
      // failed, cancelled).
      setTasks(await client.rpc<ScheduledTask[]>("get_scheduled_tasks", { include_done: true }));
    } catch (e) {
      console.error(e);
      setTasks([]);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3_000);
    return () => clearInterval(t);
  }, [refresh]);

  const cancel = async (t: ScheduledTask) => {
    if (!t.id) return;
    await client.rpc("cancel_scheduled_task", { task_id: t.id });
    void refresh();
  };

  const all = tasks || [];
  const activeFilter = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const q = query.trim().toLowerCase();
  const visible = all
    .filter((t) => activeFilter.match(t.status || ""))
    .filter(
      (t) =>
        !q ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.id || "").toLowerCase().includes(q),
    )
    .sort(COMPARE[sortBy]);

  const hasTasks = all.length > 0;
  // No tabs or search over an empty list.
  const headerExtras = hasTasks ? (
    <PageTabs<FilterKey>
      tabs={FILTERS.map((f) => ({
        key: f.key,
        label: f.label,
        count: all.filter((t) => f.match(t.status || "")).length,
      }))}
      current={filter}
      onSelect={setFilter}
      controls={
        <PageHeaderControls<string, SortKey>
          search={{
            value: query,
            onChange: setQuery,
            placeholder: "Search description or id…",
            label: "Search tasks",
          }}
          sort={{ options: SORTS, current: sortBy, onPick: setSortBy }}
        />
      }
    />
  ) : undefined;

  return (
    <Drawer title="Scheduled tasks" headerExtras={headerExtras} onClose={onClose}>
      {tasks === null && <PageLoading />}
      {tasks?.length === 0 && (
        <PageEmpty
          title="Nothing scheduled"
          hint={
            <>
              Use <code>/schedule &lt;description&gt; every &lt;time&gt;</code>.
            </>
          }
        />
      )}
      {hasTasks && visible.length === 0 && (
        <PageEmpty
          title={q ? "No tasks match" : activeFilter.empty}
          hint={q ? undefined : "The other tabs hold the rest."}
        />
      )}
      {visible.length > 0 && (
        <CardGrid flow className="task-grid">
          {visible.map((t, i) => (
            <TaskCard key={t.id || i} task={t} onCancel={() => void cancel(t)} />
          ))}
        </CardGrid>
      )}
    </Drawer>
  );
}
