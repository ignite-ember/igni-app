/** One skill's own page: the command, where it comes from, how it runs,
 *  and its full instructions — what a card can only hint at. */

import { PlayGlyph } from "../../page/CardAction";
import { EntityHero } from "../../page/EntityHero";
import { PlainMarkdown } from "../../markdown/PlainMarkdown";
import { SOURCE_LABELS, sourceOf, type SkillRow } from "./skillsView";

export function SkillDetail({ skill, onRun }: { skill: SkillRow; onRun: () => void }) {
  const name = skill.name ?? "";
  const source = sourceOf(skill);
  const body = (skill.body ?? "").trim();
  return (
    <div className="entity-detail skill-detail">
      <EntityHero
        name={`/${name}`}
        meta={
          <>
            <span className={`entity-chip skill-source is-${source}`}>{SOURCE_LABELS[source]}</span>
            {skill.category && <span className="entity-meta">{skill.category}</span>}
            {skill.version && <span className="entity-meta">v{skill.version}</span>}
          </>
        }
        description={skill.description}
        chips={
          (skill.argument_hint || (skill.context === "fork" && skill.agent)) && (
            <>
              {skill.argument_hint && (
                <span className="entity-chip skill-hero-chip">
                  takes <code className="skill-args">{skill.argument_hint}</code>
                </span>
              )}
              {skill.context === "fork" && skill.agent && (
                <span className="entity-chip skill-hero-chip">runs on {skill.agent}</span>
              )}
            </>
          )
        }
        actions={
          <button
            className="btn btn-sm btn-primary workflow-run-btn"
            onClick={onRun}
            aria-label={`Run /${name}`}
          >
            <PlayGlyph size={10} /> Run
          </button>
        }
      />
      <section className="workflow-detail-section">
        <h3 className="workflow-detail-heading">Instructions</h3>
        {body ? (
          <div className="plugins-readme markdown-body skill-body">
            <PlainMarkdown text={body} />
          </div>
        ) : (
          <p className="workflow-detail-text">
            igni did not send this skill's instructions
            {skill.source_dir ? ", so they can only be read in its folder." : "."}
          </p>
        )}
      </section>
      {skill.source_dir && (
        <div className="workflow-detail-path">
          <code>{skill.source_dir}</code>
        </div>
      )}
    </div>
  );
}
