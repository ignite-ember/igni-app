/** One workflow's own page: what it is, when to reach for it, and each
 *  phase it walks through — the part a card can only hint at. */

import { EntityHero } from "../../page/EntityHero";
import { PlayGlyph } from "../../page/CardAction";
import { phaseCount, workflowSource, type WorkflowMeta } from "./workflowsView";

export function WorkflowDetail({ workflow, onRun }: { workflow: WorkflowMeta; onRun: () => void }) {
  const phases = workflow.phases ?? [];
  return (
    <div className="entity-detail">
      <EntityHero
        name={workflow.name ?? "(unnamed)"}
        meta={
          <>
            <span className="entity-chip workflow-source">{workflowSource(workflow)}</span>
            <span className="entity-meta">{phaseCount(workflow)}</span>
          </>
        }
        description={workflow.description}
        actions={
          <button className="btn btn-sm btn-primary workflow-run-btn" onClick={onRun}>
            <PlayGlyph size={10} /> Run
          </button>
        }
      />
      {workflow.whenToUse && (
        <section className="workflow-detail-section">
          <h3 className="workflow-detail-heading">When to use</h3>
          <p className="workflow-detail-text">{workflow.whenToUse}</p>
        </section>
      )}
      {phases.length > 0 && (
        <section className="workflow-detail-section">
          <h3 className="workflow-detail-heading">Phases</h3>
          <ol className="workflow-steps">
            {phases.map((p, i) => (
              <li className="workflow-step" key={`${p.title ?? i}-${i}`}>
                <span className="workflow-step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="workflow-step-body">
                  <div className="workflow-step-title">
                    {p.title ?? `Phase ${i + 1}`}
                    {p.model && <span className="entity-meta">{p.model}</span>}
                  </div>
                  {p.detail && <div className="workflow-step-detail">{p.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {workflow.path && (
        <div className="workflow-detail-path">
          <code>{workflow.path}</code>
        </div>
      )}
    </div>
  );
}
