import { useCallback, useEffect, useState } from "react";

import { Drawer } from "../panels/Drawer";
import type { IgniClient } from "../../protocol/client";
import { countOf } from "../../lib/plural";
import { CardAction } from "../page/CardAction";
import { CardGrid } from "../page/CardGrid";
import { CardGridSkeleton } from "../page/CardGridSkeleton";
import { EntityCard } from "../page/EntityCard";
import { PageEmpty } from "../page/PageEmpty";
import { PageHeaderControls } from "../page/PageHeaderControls";
import { WorkflowDetail } from "./workflows/WorkflowDetail";
import {
  WORKFLOW_FILTERS,
  WORKFLOW_SORTS,
  phaseCount,
  visibleWorkflows,
  workflowSource,
  type WorkflowFilter,
  type WorkflowMeta,
  type WorkflowSort,
} from "./workflows/workflowsView";

/** Phase titles a card shows before it says "+N more". */
const CARD_PHASES = 4;

/**
 * The workflows this project defines.
 *
 * `/workflows` with no name used to append its listing to the
 * transcript. That is how browsing what exists destroyed the chat's
 * start screen: the welcome only renders while `items.length === 0`,
 * so one listing replaced it permanently — and the start screen's own
 * card was the only place `/workflows` was advertised, so the
 * suggestion consumed the screen that made it.
 *
 * A listing is a place, not a message. Running a workflow still
 * streams into the chat, because a run *is* transcript: it has a
 * beginning, output and an end, and belongs in the conversation that
 * asked for it. A card opens the workflow's own page, with every
 * phase spelled out; its play button seeds the run straight away.
 */
export function WorkflowsPage({
  client,
  onRun,
  onClose,
}: {
  client: IgniClient;
  /** Seeds the composer with `/workflows <name>` rather than firing
   *  it. Several take a JSON argument object, and the phase list is
   *  what tells you whether you want this one at all. */
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorkflowFilter>("all");
  const [sort, setSort] = useState<WorkflowSort>("name");
  const [selected, setSelected] = useState<WorkflowMeta | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const listed = await client.rpc<WorkflowMeta[]>("list_workflows");
      setWorkflows(Array.isArray(listed) ? listed : []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const all = workflows ?? [];
  const shown = visibleWorkflows(all, query, filter, sort);
  const run = (wf: WorkflowMeta) => onRun(`/workflows ${wf.name ?? ""}`);
  const clear = () => {
    setQuery("");
    setFilter("all");
  };

  return (
    <Drawer
      title="Workflows"
      onClose={onClose}
      levels={{
        labels: selected ? [selected.name ?? "(unnamed)"] : [],
        onTruncate: () => setSelected(null),
      }}
      // The workflow's page opens with its own name in the hero.
      titleInBody={selected !== null}
      headerExtras={
        selected ? null : (
          <PageHeaderControls
            search={
              all.length > 0
                ? {
                    value: query,
                    onChange: setQuery,
                    label: "Search workflows",
                    placeholder: `Search ${countOf(all.length, "workflow")}…`,
                  }
                : undefined
            }
            filter={
              all.length > 0
                ? { options: WORKFLOW_FILTERS, current: filter, onPick: setFilter }
                : undefined
            }
            sort={
              all.length > 0 ? { options: WORKFLOW_SORTS, current: sort, onPick: setSort } : undefined
            }
            refresh={{
              onClick: () => void load(),
              busy: loading,
              label: "Reload workflows",
              title: "Read .igni/workflows/ again",
            }}
          />
        )
      }
    >
      {selected ? (
        <WorkflowDetail workflow={selected} onRun={() => run(selected)} />
      ) : (
        <>
          {error && (
            <div className="msg-error msg-error--banner">Could not list workflows: {error}</div>
          )}

          {workflows === null && !error && <CardGridSkeleton count={4} />}

          {workflows?.length === 0 && (
            <PageEmpty
              title="No workflows yet"
              hint={
                <>
                  Put one in <code>.igni/workflows/</code>. A workflow is a script that drives
                  several agents through named phases — useful when one prompt would have to do
                  too many things at once.
                </>
              }
            />
          )}

          {all.length > 0 && shown.length === 0 && (
            <PageEmpty
              title="No workflows match"
              hint={
                query.trim() ? `Nothing named or described like “${query.trim()}”.` : "None from this source."
              }
              action={
                <button className="btn btn-sm" onClick={clear}>
                  Show all workflows
                </button>
              }
            />
          )}

          {shown.length > 0 && (
            <CardGrid>
              {shown.map((wf) => {
                const name = wf.name ?? "(unnamed)";
                const phases = wf.phases ?? [];
                return (
                  <EntityCard
                    key={wf.path || wf.name}
                    glyph={name}
                    name={<code className="workflow-card-name">{name}</code>}
                    label={`Open ${name}`}
                    onOpen={() => setSelected(wf)}
                    action={<CardAction label={`Run ${name}`} onClick={() => run(wf)} />}
                    description={wf.description || wf.whenToUse}
                    chips={
                      phases.length > 0 && (
                        <span className="workflow-card-phases">
                          {phases.slice(0, CARD_PHASES).map((p, i) => (
                            <span className="workflow-card-phase" key={`${p.title ?? i}-${i}`}>
                              {p.title ?? `Phase ${i + 1}`}
                            </span>
                          ))}
                          {phases.length > CARD_PHASES && (
                            <span className="entity-meta">+{phases.length - CARD_PHASES} more</span>
                          )}
                        </span>
                      )
                    }
                    footer={
                      <>
                        <span className="entity-chip workflow-source">{workflowSource(wf)}</span>
                        <span className="entity-meta workflow-card-count">{phaseCount(wf)}</span>
                      </>
                    }
                  />
                );
              })}
            </CardGrid>
          )}
        </>
      )}
    </Drawer>
  );
}
