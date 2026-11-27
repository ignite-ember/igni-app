/** An agent as `get_agent_details` sends it, where it came from, and
 *  how the list is searched, narrowed and ordered. */

export interface AgentRow {
  name?: string;
  description?: string;
  model?: string;
  is_ephemeral?: boolean;
  can_orchestrate?: boolean;
  tools?: string[];
  unknown_tools?: string[];
  tags?: string[];
  mcp_servers?: string[];
  system_prompt?: string;
  source_path?: string;
}

/** Where an agent's definition lives. */
export type AgentSource = "builtin" | "project" | "personal" | "user" | "plugin" | "session";

export const SOURCE_LABELS: Record<AgentSource, string> = {
  builtin: "Built-in",
  project: "Project",
  personal: "Personal",
  user: "User",
  plugin: "Plugin",
  session: "Unsaved",
};

/** The order the sources sort in and the filter lists them. */
const SOURCE_ORDER: AgentSource[] = ["session", "project", "personal", "user", "plugin", "builtin"];

/** A path under someone's home directory rather than a project. */
const HOME_AGENTS = /^(?:~|\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:[\\/]Users[\\/][^\\/]+)[\\/]\.(?:igni|claude)[\\/]agents[\\/]/;

/** The agent's source, read from its name and the file it was loaded from. */
export function agentSource(a: AgentRow): AgentSource {
  if (a.is_ephemeral) return "session";
  if ((a.name ?? "").includes(":")) return "plugin";
  const path = a.source_path ?? "";
  if (!path || /[\\/]bundled_agents[\\/]/.test(path)) return "builtin";
  if (/[\\/]agents\.local[\\/]/.test(path)) return "personal";
  if (HOME_AGENTS.test(path)) return "user";
  return "project";
}

/** The plugin an agent ships with (`plugin:agent`), or "". */
export function agentPlugin(a: AgentRow): string {
  const name = a.name ?? "";
  const i = name.indexOf(":");
  return i > 0 ? name.slice(0, i) : "";
}

/** The agent's own name, without its plugin's prefix. */
export function agentShortName(a: AgentRow): string {
  const name = a.name ?? "";
  return name.slice(name.indexOf(":") + 1);
}

/** The filter value that keeps every source. */
export const ALL_SOURCES = "all";

export type AgentSort = "name" | "source";

export const SORT_OPTIONS: { key: AgentSort; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "source", label: "Source" },
];

/** "All" plus each source the list actually has, in source order. */
export function sourceFilterOptions(agents: AgentRow[]): { key: string; label: string }[] {
  const present = new Set(agents.map(agentSource));
  return [
    { key: ALL_SOURCES, label: "All sources" },
    ...SOURCE_ORDER.filter((s) => present.has(s)).map((s) => ({ key: s, label: SOURCE_LABELS[s] })),
  ];
}

/** The agents matching the search, kept to one source, in the chosen order. */
export function visibleAgents(
  agents: AgentRow[],
  query: string,
  source: string,
  sort: AgentSort,
): AgentRow[] {
  const q = query.trim().toLowerCase();
  const byName = (a: AgentRow, b: AgentRow) => (a.name ?? "").localeCompare(b.name ?? "");
  return agents
    .filter((a) => source === ALL_SOURCES || agentSource(a) === source)
    .filter(
      (a) =>
        !q ||
        (a.name ?? "").toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q),
    )
    .sort(
      sort === "source"
        ? (a, b) =>
            SOURCE_ORDER.indexOf(agentSource(a)) - SOURCE_ORDER.indexOf(agentSource(b)) ||
            byName(a, b)
        : byName,
    );
}

/** "12 tools", or "All tools" when the agent is not restricted. */
export function toolsSummary(a: AgentRow): string {
  const n = a.tools?.length ?? 0;
  if (n === 0) return "All tools";
  return `${n} tool${n === 1 ? "" : "s"}`;
}
