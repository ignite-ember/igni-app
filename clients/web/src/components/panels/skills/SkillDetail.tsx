/** One skill's own page: the command, where it comes from, how it runs,
 *  and its full instructions — what a card can only hint at. */

import { PlayGlyph } from "../../page/CardAction";
import { DetailFacts } from "../../page/DetailFacts";
import { DetailMarkdown } from "../../page/DetailMarkdown";
import { DetailSection } from "../../page/DetailSection";
import { EntityHero } from "../../page/EntityHero";
import { HeroChip } from "../../page/HeroChip";
import { PlainMarkdown } from "../../markdown/PlainMarkdown";
import { SOURCE_LABELS, sourceOf, type SkillRow } from "./skillsView";

export function SkillDetail({ skill, onRun }: { skill: SkillRow; onRun: () => void }) {
  const name = skill.name ?? "";
  const body = (skill.body ?? "").trim();
  return (
    <div className="entity-detail skill-detail">
      <EntityHero
        name={`/${name}`}
        meta={
          (skill.category || skill.version) && (
            <>
              {skill.category && <span className="entity-meta">{skill.category}</span>}
              {skill.version && <span className="entity-meta">v{skill.version}</span>}
            </>
          )
        }
        description={skill.description}
        chips={
          <>
            <HeroChip>{SOURCE_LABELS[sourceOf(skill)]}</HeroChip>
            {skill.argument_hint && <HeroChip>takes {skill.argument_hint}</HeroChip>}
            {skill.context === "fork" && skill.agent && <HeroChip>runs on {skill.agent}</HeroChip>}
          </>
        }
        actions={
          <button className="btn btn-sm btn-primary" onClick={onRun} aria-label={`Run /${name}`}>
            <PlayGlyph size={10} /> Run
          </button>
        }
      />
      <DetailSection title="Instructions">
        {body ? (
          <DetailMarkdown>
            <PlainMarkdown text={body} />
          </DetailMarkdown>
        ) : (
          <p className="workflow-detail-text">
            igni did not send this skill's instructions
            {skill.source_dir ? ", so they can only be read in its folder." : "."}
          </p>
        )}
      </DetailSection>
      {skill.source_dir && (
        <DetailSection title="Source">
          <DetailFacts facts={[{ label: "Folder", value: skill.source_dir, mono: true }]} />
        </DetailSection>
      )}
    </div>
  );
}
