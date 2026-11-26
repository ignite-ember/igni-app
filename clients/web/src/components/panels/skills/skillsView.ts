/** What the Skills page shows: where each skill comes from, and the
 *  search, source filter and order the header's controls drive. */

/** One skill as `get_skill_details` sends it (the fields this page reads). */
export interface SkillRow {
  name?: string;
  description?: string;
  category?: string;
  argument_hint?: string;
  context?: string;
  agent?: string;
  source_dir?: string;
}

export type SkillSource = "project" | "user" | "plugin" | "builtin";

export type SourceFilter = "all" | SkillSource;

export type SkillSort = "name" | "source" | "category";

export const SOURCE_LABELS: Record<SkillSource, string> = {
  project: "project",
  user: "user",
  plugin: "plugin",
  builtin: "built-in",
};

export const SKILL_SORTS: readonly { key: SkillSort; label: string }[] = [
  { key: "name", label: "Name (A–Z)" },
  { key: "source", label: "Source" },
  { key: "category", label: "Category" },
];

const SOURCE_ORDER: SkillSource[] = ["project", "user", "plugin", "builtin"];

/** A home directory's own `.igni/skills` or `.claude/skills`. */
const USER_DIR = /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:[\\/]Users[\\/][^\\/]+)[\\/]\.(?:igni|claude)[\\/]skills(?:[\\/]|$)/;

/** Where a skill was loaded from. A plugin's skills are namespaced
 *  `plugin:skill`; the bundled ones come from igni itself; a home
 *  directory's skills are the user's; anything else is the project's. */
export function sourceOf(skill: SkillRow): SkillSource {
  const dir = skill.source_dir ?? "";
  if ((skill.name ?? "").includes(":")) return "plugin";
  if (!dir || /[\\/]bundled_skills(?:[\\/]|$)/.test(dir)) return "builtin";
  if (USER_DIR.test(dir)) return "user";
  return "project";
}

/** The filter's options: every source, then only the ones present. */
export function sourceFilters(skills: SkillRow[]): { key: SourceFilter; label: string }[] {
  const present = new Set(skills.map(sourceOf));
  return [
    { key: "all", label: "All sources" },
    ...SOURCE_ORDER.filter((s) => present.has(s)).map((s) => ({
      key: s,
      label: SOURCE_LABELS[s].charAt(0).toUpperCase() + SOURCE_LABELS[s].slice(1),
    })),
  ];
}

/** The skills matching `query` (name, description, category) and the
 *  source filter, in the chosen order. */
export function visibleSkills(
  skills: SkillRow[],
  query: string,
  filter: SourceFilter,
  sort: SkillSort,
): SkillRow[] {
  const term = query.trim().toLowerCase();
  const hit = (skill: SkillRow) =>
    !term ||
    [skill.name, skill.description, skill.category].some((f) => (f ?? "").toLowerCase().includes(term));
  const byName = (a: SkillRow, b: SkillRow) => (a.name ?? "").localeCompare(b.name ?? "");
  const shown = skills.filter((skill) => hit(skill) && (filter === "all" || sourceOf(skill) === filter));
  if (sort === "source")
    return shown.sort(
      (a, b) => SOURCE_ORDER.indexOf(sourceOf(a)) - SOURCE_ORDER.indexOf(sourceOf(b)) || byName(a, b),
    );
  if (sort === "category")
    return shown.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || byName(a, b));
  return shown.sort(byName);
}
