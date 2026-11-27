import { useState } from "react";
import { Drawer } from "../panels/Drawer";
import { BUILTIN_COMMANDS, type SlashCommand } from "../../chat/slashCommands";
import { PageEmpty } from "../page/PageEmpty";
import { PageHeaderControls } from "../page/PageHeaderControls";

/**
 * Every command, grouped.
 *
 * This was `/help` building a markdown list of all twenty-eight
 * commands plus every installed skill and handing it to a 620px modal.
 * It is the only complete index of what the product can do and the
 * first thing a new user opens, and it was arriving as one flat
 * alphabetical-by-accident wall.
 *
 * Grouped by what you are trying to do rather than by what the command
 * touches, because someone reading this does not yet know what the
 * subsystems are called — that is why they are here.
 */
const GROUPS: { title: string; blurb: string; commands: string[] }[] = [
  {
    title: "This conversation",
    blurb: "Start over, trim it down, or find out what is filling it up.",
    commands: ["/clear", "/compact", "/ctx", "/rename", "/fork"],
  },
  {
    title: "Getting around",
    blurb: "Move between conversations, or come back here.",
    commands: ["/sessions", "/help", "/quit"],
  },
  {
    title: "What the agent can reach",
    blurb: "The tools and extensions available to a run.",
    commands: ["/agents", "/skills", "/plugins", "/plugin", "/extensions", "/mcp", "/hooks"],
  },
  {
    title: "Running work",
    blurb: "Repeat a prompt, or hand work to the background.",
    commands: ["/loop", "/workflows", "/schedule", "/evals"],
  },
  {
    title: "How much it may do on its own",
    blurb: "Permission modes, from proposing to acting unattended.",
    commands: ["/plan", "/accept", "/bypass"],
  },
  {
    title: "Setup",
    blurb: "The model, the account, and the rest of the settings.",
    commands: [
      "/model",
      "/login",
      "/logout",
      "/whoami",
      "/config",
      "/memory",
      "/output-style",
      "/bug",
    ],
  },
];

/** Commands in `GROUPS` that no longer exist, and commands that exist
 *  in no group — either is a list that has drifted from the code. */
export function groupingDrift(commands: SlashCommand[]): {
  missing: string[];
  ungrouped: string[];
} {
  const known = new Set(commands.map((c) => c.name));
  const placed = new Set(GROUPS.flatMap((g) => g.commands));
  return {
    missing: [...placed].filter((name) => !known.has(name)).sort(),
    ungrouped: [...known].filter((name) => !placed.has(name)).sort(),
  };
}

export function HelpPage({
  skills,
  onRun,
  onClose,
}: {
  /** Skills are user- and plugin-supplied, so they cannot be grouped
   *  by hand — they get their own section. */
  skills: SlashCommand[];
  /** Drop a command into the composer rather than firing it. Reading
   *  help is not the same as deciding to run something, and several
   *  of these take arguments. */
  onRun: (name: string) => void;
  onClose: () => void;
}) {
  const byName = new Map(BUILTIN_COMMANDS.map((c) => [c.name, c]));
  const [query, setQuery] = useState("");

  // Anything the groups above have not placed still has to appear —
  // a command missing from help because nobody updated a list here is
  // worse than one in the wrong section.
  const { ungrouped } = groupingDrift(BUILTIN_COMMANDS);
  const q = query.trim().toLowerCase();
  const matches = (name: string, description?: string) =>
    !q || name.toLowerCase().includes(q) || (description ?? "").toLowerCase().includes(q);
  const sections = [
    ...GROUPS.map((g) => ({ ...g, commands: g.commands.filter((n) => byName.has(n)) })),
    ...(ungrouped.length ? [{ title: "Other", blurb: "", commands: ungrouped }] : []),
    {
      title: "Skills",
      blurb: "Workflows from this project and its installed plugins.",
      commands: skills.map((s) => s.name),
    },
  ]
    .map((g) => ({ ...g, commands: g.commands.filter((n) => matches(n, descriptionOf(n))) }))
    .filter((g) => g.commands.length > 0);

  function descriptionOf(name: string): string | undefined {
    return byName.get(name)?.description ?? skills.find((s) => s.name === name)?.description;
  }

  return (
    <Drawer
      title="Help"
      onClose={onClose}
      headerExtras={
        <PageHeaderControls
          search={{
            value: query,
            onChange: setQuery,
            placeholder: "Search commands…",
            label: "Search commands",
          }}
        />
      }
    >
      <p className="help-intro">
        Type <code>/</code> in the composer to search these, <code>@</code> for files, and{" "}
        <code>$</code> to run a shell command.
      </p>

      {sections.length === 0 && <PageEmpty title="No commands match" hint="Try a shorter word." />}

      {sections.map((group) => (
        <section className="help-group" key={group.title}>
          <h2 className="help-group-title">{group.title}</h2>
          {group.blurb && <p className="help-group-blurb">{group.blurb}</p>}
          <div className="help-commands">
            {group.commands.map((name) => (
              <button className="help-command" key={name} onClick={() => onRun(name)}>
                <code className="help-command-name">{name}</code>
                <span className="help-command-desc">{descriptionOf(name)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Drawer>
  );
}
