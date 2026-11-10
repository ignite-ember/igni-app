/**
 * The slash-command pool the composer's `/` menu offers.
 *
 *   - BUILTIN_COMMANDS — structural contract (the FE call sites trust
 *     this list to be well-formed and to include the commands the
 *     backend's CommandHandler exposes).
 *   - SlashCommandCatalog.merge — the menu offers what the backend can
 *     run. It used to offer a hand-maintained copy of that list, which
 *     had drifted both ways: one command advertised that does not
 *     exist, and nine real ones nobody could discover from the menu.
 *   - SlashCommandCatalog#filter — the prefix filter the `/`
 *     autocomplete uses, testable without the contenteditable.
 */

import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMMANDS,
  CLIENT_ONLY_COMMANDS,
  SlashCommandCatalog,
  type SlashCommand,
} from "./slashCommands";

describe("BUILTIN_COMMANDS — structural contract", () => {
  it("is non-empty (the built-in slash commands must exist)", () => {
    expect(BUILTIN_COMMANDS.length).toBeGreaterThan(0);
  });

  it("every command name starts with '/'", () => {
    // The autocomplete menu strips the leading slash for the
    // prefix match; anything missing it would never appear in
    // the menu (the user types ``/`` and the filter walks
    // ``name.slice(1)``).
    for (const c of BUILTIN_COMMANDS) {
      expect(c.name.startsWith("/")).toBe(true);
    }
  });

  it("every command has a non-empty description", () => {
    // The description is the second column in the menu. An
    // empty description renders as a blank line — useless to
    // the user and a hint that the entry was added carelessly.
    for (const c of BUILTIN_COMMANDS) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it("command names are unique (no duplicates)", () => {
    // Two ``/help`` entries would put the same command twice in
    // the menu and double-route on Enter. Catch the duplicate
    // at structural-test time.
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("ships every BE command handler in the autocomplete menu", () => {
    // ALL non-alias entries from ``CommandHandler._COMMANDS`` in
    // ``src/igni_core/backend/command_handler.py`` must appear in
    // ``BUILTIN_COMMANDS`` — otherwise a user types ``/x`` and the
    // menu silently omits it even though the BE handles it. This
    // list is the single source of truth; when a new handler is
    // added on the BE side, add it here AND to BUILTIN_COMMANDS
    // in the same change so they stay in lockstep.
    //
    // ``/exit`` intentionally absent — it aliases ``/quit`` on the
    // BE and listing both would clutter the menu with the same
    // action under two names.
    const REQUIRED = [
      "/help",
      "/clear",
      "/compact",
      "/ctx",
      "/sessions",
      "/fork",
      "/rename",
      "/model",
      "/login",
      "/logout",
      "/whoami",
      "/mcp",
      "/agents",
      "/skills",
      "/plugin",
      "/plugins",
      "/hooks",
      "/loop",
      "/schedule",
      "/memory",
      "/config",
      "/output-style",
      "/plan",
      "/accept",
      "/bypass",
      "/evals",
      "/bug",
      "/quit",
    ];
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    for (const required of REQUIRED) {
      expect(names).toContain(required);
    }
  });
});

describe("SlashCommandCatalog#filter", () => {
  // Use a stable mini-pool so the assertions don't churn when
  // someone adds a new built-in.
  const pool: SlashCommand[] = [
    { name: "/help", description: "Show help" },
    { name: "/clear", description: "Clear chat" },
    { name: "/compact", description: "Compact context" },
    { name: "/context", description: "Context usage" },
    { name: "/sessions", description: "List sessions" },
  ];

  it("returns the full pool for an empty query", () => {
    // User just typed ``/`` — show everything. Each command's
    // ``slice(1).startsWith("")`` is trivially true.
    expect(new SlashCommandCatalog(pool).filter("")).toEqual(pool);
  });

  it("prefix-matches on the name AFTER the leading '/'", () => {
    // Query ``co`` should match ``/compact`` and ``/context``
    // but not ``/clear`` (which starts with c, not co).
    const out = new SlashCommandCatalog(pool).filter("co");
    expect(out.map((c) => c.name)).toEqual(["/compact", "/context"]);
  });

  it("is case-insensitive", () => {
    // The user might shift their hand and type ``/COM`` —
    // still meant ``/compact``. Lowercased on both sides.
    expect(new SlashCommandCatalog(pool).filter("COM").map((c) => c.name)).toEqual([
      "/compact",
    ]);
    expect(new SlashCommandCatalog(pool).filter("Help").map((c) => c.name)).toEqual([
      "/help",
    ]);
  });

  it("returns [] when nothing matches", () => {
    // Empty result → the menu collapses, the user sees that
    // their query didn't match anything.
    expect(new SlashCommandCatalog(pool).filter("zz")).toEqual([]);
  });

  it("does NOT match substring (e.g. 'lear' does not match /clear)", () => {
    // The autocomplete is prefix-based. Substring matching
    // would surface commands for queries that the user wasn't
    // trying to complete (typo'd ``/lear`` → unwanted match).
    expect(new SlashCommandCatalog(pool).filter("lear")).toEqual([]);
  });

  it("caps at 12 results by default", () => {
    // The dropdown shows ~12 rows. If the user types just
    // ``/`` we don't want to render the whole 18-entry list +
    // every plugin's skill — capping keeps the menu scannable.
    const big: SlashCommand[] = Array.from({ length: 30 }, (_, i) => ({
      name: `/cmd${i.toString().padStart(2, "0")}`,
      description: `desc ${i}`,
    }));
    expect(new SlashCommandCatalog(big).filter("").length).toBe(12);
  });

  it("custom limit overrides the default cap", () => {
    // The helper takes a limit param — useful for surfaces
    // that want a different cap (e.g. a settings UI listing
    // all commands).
    const big: SlashCommand[] = Array.from({ length: 30 }, (_, i) => ({
      name: `/cmd${i.toString().padStart(2, "0")}`,
      description: `desc ${i}`,
    }));
    expect(new SlashCommandCatalog(big).filter("", 3).length).toBe(3);
    // limit=0 → empty (defensive; the helper doesn't ban it).
    expect(new SlashCommandCatalog(big).filter("", 0).length).toBe(0);
  });

  it("preserves source order (no implicit reordering)", () => {
    // The pool order is meaningful — the composer assigns
    // ``active: 0`` to the first match, so reordering the
    // helper's output would silently change which command is
    // highlighted by default.
    //
    // One deliberate exception, below: an exact match is promoted to
    // the front. That is the same principle, not a violation of it —
    // the first match is what Enter runs, so the command the user
    // finished typing has to be it.
    const out = new SlashCommandCatalog(pool).filter("");
    expect(out.map((c) => c.name)).toEqual(pool.map((c) => c.name));
  });

  describe("an exact match comes first", () => {
    // `/plugin` and `/plugins` in the real pool, in the order the
    // real pool lists them: the longer one first.
    const prefixPair: SlashCommand[] = [
      { name: "/plugins", description: "Open the plugins panel" },
      { name: "/plugin", description: "Install / update / remove a plugin" },
    ];

    it("promotes the exactly-typed command over a longer sibling", () => {
      // The bug, stated as the user's action. Typing the full name of
      // `/plugin` left `/plugins` highlighted; Enter compares the
      // typed text against the *highlighted* entry, so instead of
      // running the command the user had finished typing it completed
      // the text to the other one. From the user's side `/plugin` did
      // nothing — no output, no panel, not even an echoed line.
      expect(
        new SlashCommandCatalog(prefixPair).filter("plugin").map((c) => c.name),
      ).toEqual(["/plugin", "/plugins"]);
    });

    it("still offers the longer sibling", () => {
      // Promotion, not filtering. `/plugins` must stay reachable —
      // one keystroke of ArrowDown away, and still in the list for
      // anyone reading rather than typing.
      expect(new SlashCommandCatalog(prefixPair).filter("plugin")).toHaveLength(2);
    });

    it("leaves a partial query in source order", () => {
      // No exact match, nothing to promote. This is the ordinary case
      // and it must not change: the pool's order is the product's
      // opinion about which command is likeliest.
      expect(
        new SlashCommandCatalog(prefixPair).filter("plug").map((c) => c.name),
      ).toEqual(["/plugins", "/plugin"]);
    });

    it("matches case-insensitively, like the filter itself", () => {
      expect(new SlashCommandCatalog(prefixPair).filter("PLUGIN")[0].name).toBe("/plugin");
    });

    it("does nothing when the exact match is already first", () => {
      const out = new SlashCommandCatalog([
        { name: "/plugin", description: "a" },
        { name: "/plugins", description: "b" },
      ]).filter("plugin");
      expect(out.map((c) => c.name)).toEqual(["/plugin", "/plugins"]);
    });
  });

  it("works on a merged pool (built-ins + skills)", () => {
    // The real call site is ``[...BUILTIN_COMMANDS, ...skills]``.
    // Verify the helper has no built-in vs skill awareness —
    // both are just SlashCommand[] entries.
    const skills: SlashCommand[] = [
      { name: "/my-skill", description: "User skill" },
    ];
    const merged = [...pool, ...skills];
    expect(new SlashCommandCatalog(merged).filter("my-").map((c) => c.name)).toEqual([
      "/my-skill",
    ]);
  });
});

const be = (...names: string[]) =>
  names.map((name) => ({ name, description: `be: ${name}` }));

describe("SlashCommandCatalog.merge", () => {
  it("offers what the backend reports", () => {
    const merged = SlashCommandCatalog.merge(be("/commit", "/pr", "/watcher"), []).commands;

    // All three were undiscoverable before: real commands the
    // hardcoded list never mentioned.
    expect(merged.map((c) => c.name)).toEqual(
      expect.arrayContaining(["/commit", "/pr", "/watcher"]),
    );
  });

  it("drops a name the backend does not have", () => {
    const merged = SlashCommandCatalog.merge(be("/help"), []).commands;

    expect(merged.map((c) => c.name)).not.toContain("/clear");
  });

  it("keeps the GUI's wording where both have an opinion", () => {
    // The backend's descriptions are written for /help; these are
    // written for this menu.
    const curated = BUILTIN_COMMANDS.find((c) => c.name === "/login")!;
    const merged = SlashCommandCatalog.merge(be("/login"), []).commands;

    expect(merged.find((c) => c.name === "/login")!.description).toBe(
      curated.description,
    );
  });

  it("uses the backend's wording for commands the GUI never knew about", () => {
    const merged = SlashCommandCatalog.merge(be("/gpu-ai"), []).commands;

    expect(merged.find((c) => c.name === "/gpu-ai")!.description).toBe(
      "be: /gpu-ai",
    );
  });

  it("still offers client-only commands the backend cannot know about", () => {
    // `/workflows` is intercepted (chat/workflowLauncher.ts) and never reaches the
    // backend, so its absence from the RPC is correct.
    const merged = SlashCommandCatalog.merge(be("/help"), []).commands;

    for (const name of CLIENT_ONLY_COMMANDS) {
      expect(merged.map((c) => c.name)).toContain(name);
    }
  });

  it("falls back to the hardcoded list before the RPC answers", () => {
    // `null` is "not yet", not "nothing" — an empty menu during
    // startup would read as a broken app.
    expect(SlashCommandCatalog.merge(null, []).commands.length).toBe(BUILTIN_COMMANDS.length);
  });

  it("falls back when the backend is too old to answer", () => {
    expect(SlashCommandCatalog.merge([], []).commands.length).toBe(BUILTIN_COMMANDS.length);
  });

  it("does not list a skill twice when it arrives by both routes", () => {
    // Skills come back inside get_slash_commands (source: "skill")
    // and also via the older get_skill_definitions path.
    const merged = SlashCommandCatalog.merge(be("/help", "/my-skill"), [
      { name: "/my-skill", description: "from the skills RPC" },
    ]).commands;

    expect(merged.filter((c) => c.name === "/my-skill")).toHaveLength(1);
  });

  it("appends skills the backend did not report", () => {
    const merged = SlashCommandCatalog.merge(be("/help"), [
      { name: "/solo", description: "skill" },
    ]).commands;

    expect(merged.map((c) => c.name)).toContain("/solo");
  });
});

describe("SlashCommandCatalog definition builders", () => {
  it("slashes skill definitions, describing a bare one as a skill", () => {
    expect(
      SlashCommandCatalog.fromSkillDefinitions([
        { name: "commit", description: "Commit it" },
        { name: "pr" },
        { description: "nameless" },
      ]),
    ).toEqual([
      { name: "/commit", description: "Commit it" },
      { name: "/pr", description: "skill" },
    ]);
  });

  it("slashes the backend's commands", () => {
    expect(SlashCommandCatalog.fromBackendCommands([{ name: "help", description: "" }])).toEqual([
      { name: "/help", description: "" },
    ]);
  });

  it("reads anything that is not a list as nothing", () => {
    expect(SlashCommandCatalog.fromSkillDefinitions(null)).toEqual([]);
    expect(SlashCommandCatalog.fromBackendCommands({ name: "x" })).toEqual([]);
  });
});
