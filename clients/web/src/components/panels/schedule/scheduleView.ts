/** What the Scheduled tasks page shows: a task's state, its tabs, the
 *  orders the Sort menu offers, and how its times read. */

/** One task as `get_scheduled_tasks` sends it. */
export interface ScheduledTask {
  id?: string;
  description?: string;
  scheduled_at?: string;
  status?: string;
  recurrence?: string;
  result?: string;
  error?: string;
  created_at?: string;
}

export const isLive = (s?: string) => s === "pending" || s === "running";

/** "Next run" while waiting, "Ran" once it has, "Was due" when cancelled first. */
export function whenLabel(status: string): string {
  if (isLive(status)) return "Next run";
  return status === "cancelled" ? "Was due" : "Ran";
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A task's name: its description, or a placeholder for none. */
export const taskName = (t: ScheduledTask) => t.description || "(no description)";

/** Text a model wrote in markdown: a heading, a list, emphasis, a fence,
 *  a link, a quote or a table row. Anything else reads as plain output. */
const MARKDOWN = /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|\*\*[^*]+\*\*|^\x60{3}|\[[^\]]+\]\([^)]+\)|^>\s|^\|.*\|\s*$/m;

export const looksLikeMarkdown = (text: string) => MARKDOWN.test(text);

export type FilterKey = "active" | "all" | "completed" | "failed" | "cancelled";

export const FILTERS: { key: FilterKey; label: string; empty: string; match: (s: string) => boolean }[] = [
  { key: "active", label: "Active", empty: "Nothing waiting to run", match: isLive },
  { key: "all", label: "All", empty: "No tasks", match: () => true },
  { key: "completed", label: "Done", empty: "Nothing has finished yet", match: (s) => s === "completed" },
  { key: "failed", label: "Failed", empty: "Nothing has failed", match: (s) => s === "failed" },
  { key: "cancelled", label: "Cancelled", empty: "Nothing cancelled", match: (s) => s === "cancelled" },
];

export type SortKey = "live" | "soonest" | "name";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "live", label: "Waiting first" },
  { key: "soonest", label: "Soonest first" },
  { key: "name", label: "Name" },
];

export const COMPARE: Record<SortKey, (a: ScheduledTask, b: ScheduledTask) => number> = {
  // Pending/running first, then the latest scheduled_at within each band.
  live: (a, b) => {
    const band = (s?: string) => (isLive(s) ? 0 : 1);
    return band(a.status) - band(b.status) || (b.scheduled_at || "").localeCompare(a.scheduled_at || "");
  },
  // A task with no time sinks to the bottom.
  soonest: (a, b) => (a.scheduled_at || "￿").localeCompare(b.scheduled_at || "￿"),
  name: (a, b) => (a.description || "").localeCompare(b.description || ""),
};
