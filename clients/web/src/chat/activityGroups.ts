/**
 * The transcript as rows: each run of tool calls and thinking between
 * two pieces of text for the person becomes one activity group.
 *
 * A group ends at the assistant's next text, at a user message, and at
 * anything else that is not activity (a plan card, an error, a team
 * card, a visualization), so whatever needs the person stays a row of
 * its own. Pure over the item list: the rows are rebuilt from it on
 * every render, and a streamed item lands in the last group in place.
 */

import type { ChatItem, ThinkingItem, ToolItem } from "./chatItem";

/** One plain item, shown as it always was. */
export interface ItemRow {
  kind: "item";
  /** Virtuoso's key for the row. */
  key: string;
  item: ChatItem;
  /** Where the item sits in the item list. */
  index: number;
}

/** A run of activity items between two pieces of text. */
export interface ActivityGroup {
  /** The same for this group across streaming and reloads, when its
   *  turn's run is known: the run and the group's place in it. */
  key: string;
  items: ChatItem[];
  /** Where the first item sits in the item list. */
  start: number;
  /** Nothing but queued messages after it: the turn can still add to it. */
  tail: boolean;
}

/** An activity group, shown as one container. */
export interface ActivityRow {
  kind: "activity";
  key: string;
  group: ActivityGroup;
}

export type TranscriptRow = ItemRow | ActivityRow;

/** Item kinds an activity group gathers. */
const ACTIVITY_KINDS: ReadonlySet<ChatItem["kind"]> = new Set(["tool", "thinking", "agent"]);

/** Whether ``item`` belongs in an activity group. */
export function isActivity(item: ChatItem): boolean {
  return ACTIVITY_KINDS.has(item.kind);
}

/** A queued message or its note: below everything the running turn adds. */
const isQueued = (it: ChatItem): boolean =>
  (it.kind === "user" || it.kind === "info") && it.queued === true;

/** The rows of a transcript, with the way back from an item to its row. */
export class TranscriptRows {
  private constructor(
    readonly rows: TranscriptRow[],
    /** ``rowOf[i]``: the row the i-th item is drawn in. */
    private readonly rowOf: number[],
  ) {}

  /** Group ``items`` into rows. */
  static of(items: readonly ChatItem[]): TranscriptRows {
    const rows: TranscriptRow[] = [];
    const rowOf: number[] = new Array(items.length);
    let turnRun = "";
    let ordinal = 0;
    let open: ActivityGroup | null = null;
    let tailStart = items.length;
    while (tailStart > 0 && isQueued(items[tailStart - 1])) tailStart--;

    items.forEach((item, index) => {
      if (item.kind === "user" || item.kind === "loop") {
        turnRun = item.kind === "user" ? (item.runId ?? "") : "";
        ordinal = 0;
      }
      if (!isActivity(item)) {
        open = null;
        rowOf[index] = rows.length;
        rows.push({ kind: "item", key: `i${item.id}`, item, index });
        return;
      }
      if (open === null) {
        const run = turnRun || firstToolRun(items, index);
        const key = run ? `${run}:${ordinal}` : `item:${item.id}`;
        ordinal++;
        open = { key, items: [], start: index, tail: false };
        rows.push({ kind: "activity", key: `a${item.id}`, group: open });
      }
      open.items.push(item);
      rowOf[index] = rows.length - 1;
    });

    const lastRow = rowOf[tailStart - 1];
    const last = lastRow === undefined ? undefined : rows[lastRow];
    if (last?.kind === "activity") last.group.tail = true;
    return new TranscriptRows(rows, rowOf);
  }

  /** The row the item at ``itemIndex`` is drawn in. */
  rowOfItem(itemIndex: number): number {
    if (this.rowOf.length === 0) return 0;
    const clamped = Math.max(0, Math.min(itemIndex, this.rowOf.length - 1));
    return this.rowOf[clamped];
  }

  /** The first item drawn in ``rowIndex``. */
  itemOfRow(rowIndex: number): number {
    const row = this.rows[Math.max(0, Math.min(rowIndex, this.rows.length - 1))];
    if (!row) return 0;
    return row.kind === "item" ? row.index : row.group.start;
  }

  /** The group holding the item with ``itemId``, if one does. */
  groupOfItemId(itemId: number): ActivityGroup | null {
    for (const row of this.rows) {
      if (row.kind === "activity" && row.group.items.some((it) => it.id === itemId)) return row.group;
    }
    return null;
  }
}

/** The run of the first tool in the run of activity from ``from``. */
function firstToolRun(items: readonly ChatItem[], from: number): string {
  for (let i = from; i < items.length && isActivity(items[i]); i++) {
    const it = items[i];
    if (it.kind === "tool" && it.runId) return it.runId;
  }
  return "";
}

/** What kind of step a tool call is, for the finished summary. */
export type StepKind = "command" | "read" | "edit" | "search" | "fetch" | "mcp" | "agent" | "other";

/** Tool names, raw and display (``ToolFriendlyNames`` in igni-core), by step kind. */
const STEP_KINDS: Record<Exclude<StepKind, "other" | "mcp">, readonly string[]> = {
  command: ["bash", "shell", "python", "run_shell_command", "run_python_code"],
  read: ["read", "read_file"],
  edit: ["edit", "write", "edit_file", "edit_file_replace_all", "save_file", "create_file"],
  search: [
    "grep", "glob", "ls", "rg", "websearch", "knowledge",
    "grep_files", "grep_count", "glob_files", "list_files", "web_search", "search_knowledge_base",
  ],
  fetch: ["webfetch", "fetch_url", "fetch_json"],
  agent: ["agent", "team", "delegate", "spawn_agent", "spawn_team"],
};

/** The step kind of a tool called ``name``. */
export function stepKindOf(name: string): StepKind {
  const key = name.trim().toLowerCase();
  // An MCP server's tools, an extension's among them, are registered
  // under ``mcp_<server>_`` (``igni_core.core.mcp.naming``).
  if (key.startsWith("mcp_")) return "mcp";
  for (const [kind, names] of Object.entries(STEP_KINDS)) {
    if (names.includes(key)) return kind as StepKind;
  }
  return "other";
}

/** Counts over a group, for its collapsed row. */
export interface ActivityCounts {
  /** Every item in the group. */
  steps: number;
  command: number;
  read: number;
  edit: number;
  search: number;
  fetch: number;
  mcp: number;
  agent: number;
  other: number;
  thoughts: number;
  failed: number;
  /** Commands that finished without an error. */
  commandsOk: number;
  /** A tool still waiting on its result. */
  runningTools: number;
}

/** The counts of ``items``. */
export function countActivity(items: readonly ChatItem[]): ActivityCounts {
  const counts: ActivityCounts = {
    steps: items.length,
    command: 0,
    read: 0,
    edit: 0,
    search: 0,
    fetch: 0,
    mcp: 0,
    agent: 0,
    other: 0,
    thoughts: 0,
    failed: 0,
    commandsOk: 0,
    runningTools: 0,
  };
  for (const it of items) {
    if (it.kind === "thinking") counts.thoughts++;
    else if (it.kind === "agent") counts.agent++;
    else if (it.kind === "tool") {
      const kind = stepKindOf(it.name);
      counts[kind]++;
      if (it.status === "error") counts.failed++;
      if (kind === "command" && it.status === "done") counts.commandsOk++;
      if (it.status === "running") counts.runningTools++;
    }
  }
  return counts;
}

/** ``n`` of a noun, with its plural. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What a finished group did, as one phrase. */
export function summaryText(c: ActivityCounts): string {
  const parts: string[] = [];
  if (c.command) parts.push(`ran ${plural(c.command, "command", "commands")}`);
  if (c.read) parts.push(`read ${plural(c.read, "file", "files")}`);
  if (c.edit) parts.push(`edited ${plural(c.edit, "file", "files")}`);
  if (c.search) parts.push(`ran ${plural(c.search, "search", "searches")}`);
  if (c.fetch) parts.push(`fetched ${plural(c.fetch, "page", "pages")}`);
  if (c.mcp) parts.push(`called ${plural(c.mcp, "MCP tool", "MCP tools")}`);
  if (c.agent) parts.push(`started ${plural(c.agent, "agent", "agents")}`);
  if (c.other) parts.push(`used ${plural(c.other, "tool", "tools")}`);
  if (c.thoughts) parts.push(c.thoughts === 1 ? "thought" : `thought ${c.thoughts} times`);
  const text = parts.join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : plural(c.steps, "step", "steps");
}

/** The step a running group is on: its last item. */
export type CurrentStep =
  | { kind: "tool"; item: ToolItem }
  | { kind: "thinking"; item: ThinkingItem }
  | { kind: "agent"; text: string };

/** The step ``items`` is on, by its last item. */
export function currentStep(items: readonly ChatItem[]): CurrentStep | null {
  const running = [...items].reverse().find((it) => it.kind === "tool" && it.status === "running");
  const last = running ?? items[items.length - 1];
  if (!last) return null;
  if (last.kind === "tool") return { kind: "tool", item: last };
  if (last.kind === "thinking") return { kind: "thinking", item: last };
  if (last.kind === "agent") return { kind: "agent", text: last.text };
  return null;
}
