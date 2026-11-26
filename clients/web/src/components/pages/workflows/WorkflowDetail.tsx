/** One workflow's own page: what it is, when to reach for it, and each
 *  phase it walks through — the part a card can only hint at. */

import { PlayGlyph } from "../../page/CardAction";
import { DetailFacts } from "../../page/DetailFacts";
import { DetailSection } from "../../page/DetailSection";
import { EntityHero } from "../../page/EntityHero";
import { HeroChip } from "../../page/HeroChip";
import { phaseCount, workflowSource, type WorkflowMeta } from "./workflowsView";

export function WorkflowDetail({ workflow, onRun }: { workflow: WorkflowMeta; onRun: () => void }) {
  const phases = workflow.phases ?? [];
  return (
    <div className="entity-detail workflow-detail">
      <EntityHero
        name={workflow.name ?? "(unnamed)"}
        meta={<span className="entity-meta">{phaseCount(workflow)}</span>}
        description={workflow.description}
        chips={<HeroChip>{workflowSource(workflow)}</HeroChip>}
        actions={
          <button className="btn btn-sm btn-primary" onClick={onRun}>
            <PlayGlyph size={10} /> Run
          </button>
        }
      />
      {workflow.whenToUse && (
        <DetailSection title="When to use">
          <p className="workflow-detail-text">{workflow.whenToUse}</p>
        </DetailSection>
      )}
      {phases.length > 0 && (
        <DetailSection title="Phases" count={phases.length}>
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
        </DetailSection>
      )}
      {workflow.path && (
        <DetailSection title="Source">
          <DetailFacts facts={[{ label: "File", value: workflow.path, mono: true }]} />
        </DetailSection>
      )}
    </div>
  );
}
