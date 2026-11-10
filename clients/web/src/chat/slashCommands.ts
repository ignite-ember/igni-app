/**
 * The slash commands the composer's `/` menu offers, and the rule that
 * builds that pool from what the backend reports.
 *
 * Not UI: the composer filters it, and the Help page lists it.
 */

import { WirePayload } from "../protocol/wirePayload";

export interface SlashCommand {
  name: string;
  description: string;
}

/** Fallback list, and the GUI's wording for the commands it covers.
 *
 * This used to BE the list: thirty-two entries maintained by hand
 * beside a `get_slash_commands` RPC that returns the authoritative
 * forty. They had drifted, as a copy does — the menu advertised
 * `/workflows` (a client-side intercept, fine) and hid nine real
 * commands nobody could discover from here: /commit, /pr, /explain,
 * /resolve-issues, /watcher, /test-plan, /migration, /gpu-ai, /exit.
 *
 * The backend decides what exists now. These descriptions still win
 * where they overlap — they are written for this UI, and the
 * backend's are written for `/help` — but a name that only appears
 * here no longer reaches the menu. */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "/help", description: "Show available commands" },
  { name: "/clear", description: "Start a new conversation" },
  { name: "/compact", description: "Summarize old context to free tokens" },
  {
    name: "/ctx",
    description: "Show context breakdown — floor vs conversation",
  },
  { name: "/sessions", description: "List and switch sessions" },
  { name: "/fork", description: "Fork this session — continue in a new id" },
  { name: "/model", description: "Pick a model" },
  { name: "/login", description: "Sign in to your igni server" },
  { name: "/logout", description: "Log out" },
  { name: "/mcp", description: "MCP servers — status and toggles" },
  { name: "/agents", description: "Agent pool" },
  { name: "/skills", description: "Skill workflows" },
  { name: "/plugins", description: "Installed plugins and marketplaces" },
  { name: "/hooks", description: "Configured hooks" },
  { name: "/loop", description: "Repeat a prompt until done" },
  { name: "/schedule", description: "Background scheduled tasks" },
  {
    name: "/workflows",
    description: "Multi-phase workflows this project defines",
  },
  {
    name: "/plan",
    description: "Toggle plan mode — agent proposes, you approve",
  },
  { name: "/accept", description: "Auto-approve file edits" },
  {
    name: "/bypass",
    description: "Skip permission prompts (scoped denies still apply)",
  },
  { name: "/memory", description: "View or edit project memory" },
  { name: "/rename", description: "Rename this session" },
  { name: "/config", description: "Show current settings" },
  { name: "/whoami", description: "Show the signed-in account" },
  { name: "/output-style", description: "Switch the agent's output style" },
  { name: "/plugin", description: "Install, update, remove plugins" },
  { name: "/evals", description: "Run an evaluation suite" },
  { name: "/bug", description: "Open the bug report form" },
  { name: "/quit", description: "Exit the session" },
];

/** Commands that exist only in this client.
 *
 *  `/workflows` is intercepted (`chat/workflowLauncher.ts`) and never reaches the
 *  backend, so it is legitimately absent from `get_slash_commands`.
 *  Anything else missing from the backend's answer is drift, not a
 *  feature. */
export const CLIENT_ONLY_COMMANDS = ["/workflows"];

/** How many rows the `/` menu shows at most. */
export const SLASH_MENU_LIMIT = 12;

/** The pool the slash menu offers, and its prefix filter. */
export class SlashCommandCatalog {
  constructor(readonly commands: SlashCommand[]) {}

  /** Existence comes from the backend; wording prefers the GUI's own,
   *  which is written for this menu rather than for `/help`. While the
   *  RPC is in flight — or against a backend too old to answer it — the
   *  hardcoded list stands in, so the menu is never empty. */
  static merge(
    backend: SlashCommand[] | null,
    skills: SlashCommand[],
  ): SlashCommandCatalog {
    if (!backend || backend.length === 0) {
      return new SlashCommandCatalog([...BUILTIN_COMMANDS, ...skills]);
    }
    const curated = new Map(BUILTIN_COMMANDS.map((c) => [c.name, c.description]));
    const fromBackend = backend.map((c) => ({
      name: c.name,
      description: curated.get(c.name) || c.description,
    }));
    // Skills already arrive inside the backend's answer (source:
    // "skill"); the separate `skills` prop is the older path and is
    // merged by name so neither route duplicates a row.
    const seen = new Set(fromBackend.map((c) => c.name));
    const clientOnly = BUILTIN_COMMANDS.filter(
      (c) => CLIENT_ONLY_COMMANDS.includes(c.name) && !seen.has(c.name),
    );
    return new SlashCommandCatalog([
      ...fromBackend,
      ...clientOnly,
      ...skills.filter((s) => !seen.has(s.name)),
    ]);
  }

  /** ``get_skill_definitions``: each skill as the command that runs it. */
  static fromSkillDefinitions(raw: unknown): SlashCommand[] {
    return SlashCommandCatalog.definitions(raw, "skill");
  }

  /** ``get_slash_commands``: what the backend dispatches. It leaves the
   *  slash off deliberately — adding it is the caller's job. */
  static fromBackendCommands(raw: unknown): SlashCommand[] {
    return SlashCommandCatalog.definitions(raw, "");
  }

  /** ``{name, description}`` rows, slashed; a row without a name is dropped. */
  private static definitions(raw: unknown, fallbackDescription: string): SlashCommand[] {
    if (!Array.isArray(raw)) return [];
    const out: SlashCommand[] = [];
    for (const row of raw) {
      const p = new WirePayload(row);
      const name = p.string("name");
      if (!name) continue;
      out.push({ name: `/${name}`, description: p.string("description") || fallbackDescription });
    }
    return out;
  }

  /** Case-insensitive prefix match on the name after the leading `/`,
   *  in pool order, capped at `limit`. `query` is the text AFTER the `/`. */
  filter(query: string, limit: number = SLASH_MENU_LIMIT): SlashCommand[] {
    const q = query.toLowerCase();
    const matches = this.commands.filter((c) =>
      c.name.slice(1).toLowerCase().startsWith(q),
    );
    // An exactly-typed command outranks a longer sibling that merely starts
    // with it: typing "/plugin" in full and getting "/plugins" first means the
    // Enter key runs something the user did not type.
    const exact = matches.findIndex((c) => c.name.slice(1).toLowerCase() === q);
    if (exact > 0) {
      matches.unshift(matches.splice(exact, 1)[0]);
    }
    return matches.slice(0, limit);
  }
}
