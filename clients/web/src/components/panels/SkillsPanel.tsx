import { useCallback, useEffect, useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { countOf } from "../../lib/plural";
import { Drawer } from "./Drawer";
import { CardAction } from "../page/CardAction";
import { CardGrid } from "../page/CardGrid";
import { CardGridSkeleton } from "../page/CardGridSkeleton";
import { EntityCard } from "../page/EntityCard";
import { PageEmpty } from "../page/PageEmpty";
import { PageHeaderControls } from "../page/PageHeaderControls";
import {
  SKILL_SORTS,
  SOURCE_LABELS,
  sourceFilters,
  sourceOf,
  visibleSkills,
  type SkillRow,
  type SkillSort,
  type SourceFilter,
} from "./skills/skillsView";

/** Skill workflows — runnable straight from the page: a card, or its
 *  play button, puts `/name` in the composer. */
export function SkillsPanel({
  client,
  onRun,
  onClose,
}: {
  client: IgniClient;
  onRun: (command: string) => void;
  onClose: () => void;
}) {
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<SkillSort>("name");

  const load = useCallback(() => {
    client
      .rpc<SkillRow[]>("get_skill_details")
      .then((s) => setSkills(Array.isArray(s) ? s : []))
      .catch(() => setSkills([]));
  }, [client]);

  useEffect(load, [load]);

  const all = skills ?? [];
  const shown = visibleSkills(all, query, filter, sort);
  const run = (name: string) => {
    onClose();
    onRun(`/${name}`);
  };
  const clear = () => {
    setQuery("");
    setFilter("all");
  };

  return (
    <Drawer
      title="Skills"
      onClose={onClose}
      headerExtras={
        <PageHeaderControls
          search={
            all.length > 0
              ? {
                  value: query,
                  onChange: setQuery,
                  label: "Search skills",
                  placeholder: `Search ${countOf(all.length, "skill")}…`,
                }
              : undefined
          }
          filter={
            all.length > 0
              ? { options: sourceFilters(all), current: filter, onPick: setFilter, label: "Source" }
              : undefined
          }
          sort={all.length > 0 ? { options: SKILL_SORTS, current: sort, onPick: setSort } : undefined}
          refresh={{ onClick: load, label: "Reload skills" }}
        />
      }
    >
      {skills === null && <CardGridSkeleton />}
      {skills?.length === 0 && (
        <PageEmpty
          title="No skills installed"
          hint={
            <>
              Add some through Plugins, or put them in <code>.igni/skills/</code>.
            </>
          }
        />
      )}
      {all.length > 0 && shown.length === 0 && (
        <PageEmpty
          title="No skills match"
          hint={query.trim() ? `Nothing named or described like “${query.trim()}”.` : "None from this source."}
          action={
            <button className="btn btn-sm" onClick={clear}>
              Show all skills
            </button>
          }
        />
      )}
      {shown.length > 0 && (
        <CardGrid>
          {shown.map((s) => {
            const name = s.name ?? "";
            const source = sourceOf(s);
            return (
              <EntityCard
                key={name}
                glyph={name.split(":").pop()}
                name={<code className="skill-card-name">/{name}</code>}
                label={`/${name}`}
                onOpen={() => run(name)}
                action={<CardAction label={`Run /${name}`} onClick={() => run(name)} />}
                description={s.description}
                footer={
                  <>
                    <span className={`entity-chip skill-source is-${source}`}>{SOURCE_LABELS[source]}</span>
                    {s.category && <span className="entity-meta">{s.category}</span>}
                    {s.argument_hint && <code className="entity-meta skill-args">{s.argument_hint}</code>}
                    {s.context === "fork" && s.agent && <span className="entity-meta">runs on {s.agent}</span>}
                  </>
                }
              />
            );
          })}
        </CardGrid>
      )}
    </Drawer>
  );
}
