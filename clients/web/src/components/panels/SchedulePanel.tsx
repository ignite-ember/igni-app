/** Scheduled tasks: soft cards under Active / All / Done / Failed /
 *  Cancelled tabs; a card opens the task's own page, where its whole
 *  output reads, a level down. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { TaskDetail } from "./schedule/TaskDetail";
import {
  COMPARE,
  FILTERS,
  SORTS,
  formatWhen,
  isLive,
  taskName,
  whenLabel,
  type FilterKey,
  type ScheduledTask,
  type SortKey,
} from "./schedule/scheduleView";

function TaskCard({ task, onOpen, onCancel }: { task: ScheduledTask; onOpen: () => void; onCancel: () => void }) {
  const status = task.status || "pending";
  return (
    <EntityCard
      className="task-card"
      icon={
        <span className="entity-glyph task-glyph">
          <ClockIcon size={16} />
        </span>
      }
      name={taskName(task)}
      label={`Open ${taskName(task)}`}
      onOpen={onOpen}
      action={
        isLive(status) && (
          <CardAction label="Cancel" title="Cancel this task" danger onClick={onCancel}>
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
    />
  );
}

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
  const [selected, setSelected] = useState<ScheduledTask | null>(null);
  // Where the list was scrolled when a task opened, to land there again.
  const anchor = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const scroller = () => anchor.current?.closest<HTMLElement>(".page-body, .drawer-body") ?? null;

  useLayoutEffect(() => {
    const el = scroller();
    if (el) el.scrollTop = selected ? 0 : listScroll.current;
  }, [selected]);

  const open = (task: ScheduledTask) => {
    listScroll.current = scroller()?.scrollTop ?? 0;
    setSelected(task);
  };

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
  // The open task as the latest poll has it: its status and output move.
  const current = selected && ((selected.id && all.find((t) => t.id === selected.id)) || selected);
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
  const headerExtras = hasTasks && !current ? (
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
    <Drawer
      title="Scheduled tasks"
      levels={{
        labels: current ? [taskName(current)] : [],
        onTruncate: () => setSelected(null),
      }}
      // The task's page opens with its own name in the hero.
      titleInBody={current !== null}
      headerExtras={headerExtras}
      onClose={onClose}
    >
      <div ref={anchor} className="tasks-page">
        {current ? (
          <TaskDetail task={current} client={client} onCancel={() => cancel(current)} />
        ) : (
          <>
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
                  <TaskCard key={t.id || i} task={t} onOpen={() => open(t)} onCancel={() => void cancel(t)} />
                ))}
              </CardGrid>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
