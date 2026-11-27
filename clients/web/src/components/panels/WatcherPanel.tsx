/**
 * The background shell processes the agent or the user has started,
 * running and finished: soft cards under Running / Stopped tabs, and one
 * process's own page — its command, state and a live tail — a level
 * down. The data lives in {@link useWatcher}; this is the layout.
 */
import { useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { Drawer } from "./Drawer";
import { useNow } from "./watcher/useNow";
import { useWatcher } from "./watcher/useWatcher";
import type { ProcessRow } from "./watcher/processTable";
import { KillButton, ProcessGlyph, WatcherRow, startedClock } from "./watcher/WatcherRow";
import { WatcherTail } from "./watcher/WatcherTail";
import { CardGrid } from "../page/CardGrid";
import { DetailFacts } from "../page/DetailFacts";
import { DetailSection } from "../page/DetailSection";
import { EntityHero } from "../page/EntityHero";
import { PageEmpty } from "../page/PageEmpty";
import { PageTabs } from "../page/PageTabs";

type Tab = "all" | "running" | "stopped";

const TAB_MATCH: Record<Tab, (row: ProcessRow) => boolean> = {
  all: () => true,
  running: (row) => row.isRunning,
  stopped: (row) => !row.isRunning,
};

const TAB_EMPTY: Record<Tab, string> = {
  all: "Nothing has run here yet",
  running: "Nothing is running",
  stopped: "Nothing has stopped yet",
};

export function WatcherPanel({ client, onClose }: { client: IgniClient; onClose: () => void }) {
  const watcher = useWatcher(client);
  const { table, selected } = watcher;
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const now = useNow();

  const running = table.runningCount;
  const headerExtras =
    !selected && table.rows.size > 0 ? (
      <PageTabs<Tab>
        tabs={[
          { key: "all", label: "All", count: table.rows.size },
          { key: "running", label: "Running", count: running },
          { key: "stopped", label: "Stopped", count: table.rows.size - running },
        ]}
        current={tab}
        onSelect={setTab}
      />
    ) : null;
  const shown = table.sorted.filter(TAB_MATCH[tab]);

  return (
    <Drawer
      // The selected pid is a level on the page's trail, so the title stays constant.
      levels={{
        labels: selected ? [`PID ${selected.pid}`] : [],
        onTruncate: watcher.deselect,
      }}
      title="Watcher"
      // A process's page opens with its command in the hero.
      titleInBody={!!selected}
      headerExtras={headerExtras}
      onClose={onClose}
    >
      {watcher.loadError && <div className="msg-error">{watcher.loadError}</div>}
      {watcher.actionError && <div className="msg-error">{watcher.actionError}</div>}
      {selected ? (
        <div className="entity-detail watcher-detail">
          <EntityHero
            name={selected.cmd}
            icon={<ProcessGlyph running={selected.isRunning} size={52} />}
            meta={<span className="entity-meta">{selected.isRunning ? "running" : selected.statusLabel(0)}</span>}
            actions={selected.isRunning ? <KillButton onKill={() => watcher.kill(selected.pid)} /> : undefined}
          />
          <DetailSection title="Process">
            <DetailFacts
              facts={[
                { label: "Command", value: selected.cmd, mono: true },
                { label: "PID", value: String(selected.pid), mono: true },
                {
                  label: "State",
                  value: selected.isRunning ? `running ${selected.statusLabel(now)}` : selected.statusLabel(now),
                },
                { label: "Started", value: startedClock(selected.startedAt) },
              ]}
            />
          </DetailSection>
          <DetailSection title="Output" count={table.logsOf(selected.pid).length}>
            <WatcherTail lines={table.logsOf(selected.pid)} filter={filter} onFilter={setFilter} />
          </DetailSection>
        </div>
      ) : table.rows.size === 0 ? (
        <PageEmpty
          title={TAB_EMPTY.all}
          hint={
            <>
              Anything you start with <code>$ </code> — or that the agent backgrounds itself — shows up here while
              it runs, and stays afterwards with its exit code.
            </>
          }
        />
      ) : shown.length === 0 ? (
        <PageEmpty title={TAB_EMPTY[tab]} hint="The other tabs hold the rest." />
      ) : (
        <CardGrid className="watcher-grid">
          {shown.map((row) => (
            <WatcherRow
              key={row.pid}
              row={row}
              now={now}
              onToggle={() => watcher.toggle(row.pid)}
              onKill={() => watcher.kill(row.pid)}
            />
          ))}
        </CardGrid>
      )}
    </Drawer>
  );
}
