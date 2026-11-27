/** What the Hooks page shows: each hook once, grouped by its event in
 *  lifecycle order, where it comes from, and the script it runs. */

/** One hook as `get_hooks_details` sends it. */
export interface HookEntry {
  event: string;
  type: "command" | "webhook" | "http" | string;
  command: string;
  url: string;
  matcher: string;
  timeout_ms: number;
  background: boolean;
  /** The headers an `http` hook sends, by name only. */
  header_names?: string[];
}

// Canonical event ordering. Anything we don't recognize falls in at
// the end (alphabetical) — the BE may grow new event kinds before
// the FE knows about them.
export const EVENT_ORDER = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "SubagentStop",
];

export const EVENT_BLURB: Record<string, string> = {
  SessionStart: "Runs when a session boots — good for seeding context.",
  UserPromptSubmit: "Fires before each user message is processed.",
  PreToolUse: "Runs before a tool call. Can block or rewrite the call.",
  PostToolUse: "Runs after a successful tool call.",
  PostToolUseFailure: "Runs when a tool call fails.",
  Notification: "Side-channel notifications (HITL prompts, etc).",
  Stop: "Runs when the model finishes responding.",
  SubagentStop: "Runs when a sub-agent finishes.",
};

export const isWebhook = (h: HookEntry) => h.type === "webhook" || h.type === "http" || !!h.url;

/** What the hook runs or calls, as one line. */
export function identOf(h: HookEntry): string {
  return isWebhook(h) ? h.url || "(no url)" : h.command || "(no command)";
}

/** The backend sometimes lists the same hook from a project file and a
 *  plugin; it shows once. */
export function dedupeHooks(rows: HookEntry[]): HookEntry[] {
  const seen = new Set<string>();
  // NUL as the separator: no field can hold one, so no two hooks collide.
  return rows.filter((h) => {
    const key = [h.event, h.type, h.command, h.url, h.matcher].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Grouped by event, in lifecycle order, then unknown events A–Z. */
export function groupHooks(hooks: HookEntry[]): { event: string; hooks: HookEntry[] }[] {
  const byEvent = new Map<string, HookEntry[]>();
  for (const h of hooks) byEvent.set(h.event, [...(byEvent.get(h.event) ?? []), h]);
  const known = EVENT_ORDER.filter((ev) => byEvent.has(ev));
  const unknown = [...byEvent.keys()].filter((ev) => !EVENT_ORDER.includes(ev)).sort();
  return [...known, ...unknown].map((event) => ({ event, hooks: byEvent.get(event)! }));
}

export type HookSource = "project" | "user" | "plugin" | "default";

/** A home directory, or `~`. */
const HOME = /^(?:~|\$HOME|\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:[\\/]Users[\\/][^\\/]+)(?:[\\/]|$)/;

/** Where a hook comes from, read off the path it runs — the backend does
 *  not say. A plugin's scripts live under a `plugins` folder; igni's own
 *  under its package; one under a home directory is the user's; a
 *  relative path is the project's. */
export function sourceOf(h: HookEntry): HookSource {
  const path = scriptPath(h) ?? h.command;
  if (/[\\/]plugins?[\\/]/.test(path)) return "plugin";
  if (/[\\/](?:site-packages|igni_core)[\\/]/.test(path)) return "default";
  if (HOME.test(path)) return "user";
  return "project";
}

/** The script file a command hook runs — its first word, when that is a
 *  path — or null for an inline command or a webhook. */
export function scriptPath(h: HookEntry): string | null {
  if (isWebhook(h) || !h.command) return null;
  const first = h.command.trim().split(/\s+/)[0].replace(/^["']|["']$/g, "");
  return /[\\/]/.test(first) || /\.(?:sh|bash|zsh|py|js|mjs|ts|rb|pl|ps1)$/.test(first) ? first : null;
}

/** "5s" from 5000 ms; "—" for none. */
export function formatTimeout(ms: number): string {
  if (!ms) return "—";
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${(ms / 1000).toFixed(1)}s`;
}
