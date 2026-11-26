/** What can be done to an agent made during this session: keep it for
 *  the team, keep it for yourself, or discard it. Round icons on a
 *  card, labelled buttons on the agent's own page. */

import type { MouseEvent, ReactNode } from "react";

import { FolderIcon, TrashIcon } from "../../Icons";

/** What the panel does when one is picked. */
export type KeepChoice = "project" | "personal" | "discard";

const CHOICES: { key: KeepChoice; label: string; title: string; icon: ReactNode }[] = [
  {
    key: "project",
    label: "Keep",
    title: "Keep it for the project: .igni/agents/, committed and shared with the team",
    icon: <FolderIcon />,
  },
  {
    key: "personal",
    label: "Keep for me",
    title: "Keep it for yourself: .igni/agents.local/, not in git",
    icon: <PersonIcon />,
  },
  { key: "discard", label: "Discard", title: "Discard this agent", icon: <TrashIcon /> },
];

function PersonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="5.5" r="2.6" />
      <path d="M3 13.5c.6-2.4 2.6-3.8 5-3.8s4.4 1.4 5 3.8" />
    </svg>
  );
}

export function AgentKeepActions({
  variant,
  busy,
  onPick,
}: {
  variant: "icons" | "buttons";
  busy: boolean;
  onPick: (choice: KeepChoice) => void;
}) {
  // On a card the buttons sit inside the card's own button: a click
  // here is the action's, never a request to open the agent.
  const pick = (choice: KeepChoice) => (e: MouseEvent) => {
    e.stopPropagation();
    onPick(choice);
  };
  if (variant === "icons") {
    return (
      <span className="agent-card-actions">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            className={`kb-icon-btn${c.key === "discard" ? " is-danger" : ""}`}
            aria-label={c.label}
            title={c.title}
            disabled={busy}
            onClick={pick(c.key)}
          >
            {c.icon}
          </button>
        ))}
      </span>
    );
  }
  return (
    <>
      {CHOICES.map((c) => (
        <button
          key={c.key}
          className={`btn btn-sm${c.key === "discard" ? " btn-danger" : c.key === "project" ? " btn-primary" : ""}`}
          title={c.title}
          disabled={busy}
          onClick={pick(c.key)}
        >
          {c.label}
        </button>
      ))}
    </>
  );
}
