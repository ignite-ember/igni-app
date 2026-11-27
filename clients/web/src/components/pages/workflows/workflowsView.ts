/** What the Workflows page shows: where each workflow lives, and the
 *  search, source filter and order the header's controls drive. */

import { countOf } from "../../../lib/plural";

export interface WorkflowPhase {
  title?: string;
  detail?: string;
  model?: string;
}

export interface WorkflowMeta {
  name?: string;
  description?: string;
  whenToUse?: string;
  phases?: WorkflowPhase[];
  path?: string;
}

/** `project` for a file under the project, `user` for one outside it
 *  (your home's, or your group's). */
export type WorkflowSource = "project" | "user";

export type WorkflowFilter = "all" | WorkflowSource;

export type WorkflowSort = "name" | "phases";

export const WORKFLOW_FILTERS: readonly { key: WorkflowFilter; label: string }[] = [
  { key: "all", label: "All workflows" },
  { key: "project", label: "This project's" },
  { key: "user", label: "Yours" },
];

export const WORKFLOW_SORTS: readonly { key: WorkflowSort; label: string }[] = [
  { key: "name", label: "Name (A–Z)" },
  { key: "phases", label: "Most phases" },
];

/** The backend sends a project file's path relative to the project and
 *  any other absolute. */
export function workflowSource(wf: WorkflowMeta): WorkflowSource {
  const path = wf.path ?? "";
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) ? "user" : "project";
}

export function phaseCount(wf: WorkflowMeta): string {
  return countOf((wf.phases ?? []).length, "phase");
}

/** The workflows matching `query` (name, description, when to use,
 *  phase titles) and the source filter, in the chosen order. */
export function visibleWorkflows(
  workflows: WorkflowMeta[],
  query: string,
  filter: WorkflowFilter,
  sort: WorkflowSort,
): WorkflowMeta[] {
  const term = query.trim().toLowerCase();
  const matches = (wf: WorkflowMeta) =>
    !term ||
    [wf.name, wf.description, wf.whenToUse, ...(wf.phases ?? []).map((p) => p.title)].some((f) =>
      (f ?? "").toLowerCase().includes(term),
    );
  const byName = (a: WorkflowMeta, b: WorkflowMeta) => (a.name ?? "").localeCompare(b.name ?? "");
  const shown = workflows.filter(
    (wf) => matches(wf) && (filter === "all" || workflowSource(wf) === filter),
  );
  if (sort === "phases")
    return shown.sort((a, b) => (b.phases ?? []).length - (a.phases ?? []).length || byName(a, b));
  return shown.sort(byName);
}
