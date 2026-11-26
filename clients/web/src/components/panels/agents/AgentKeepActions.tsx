/** What can be done to an agent made during this session: keep it for
 *  the team, keep it for yourself, or discard it. Round icons on a
 *  card, labelled buttons on the agent's own page. */

import type { ReactNode } from "react";

import { FolderIcon, TrashIcon } from "../../Icons";
import { Button } from "../../page/Button";
import { CardAction } from "../../page/CardAction";

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
  if (variant === "icons") {
    // On a card: round icons that never open the agent.
    return (
      <span className="agent-card-actions">
        {CHOICES.map((c) => (
          <CardAction
            key={c.key}
            label={c.label}
            title={c.title}
            danger={c.key === "discard"}
            disabled={busy}
            onClick={() => onPick(c.key)}
          >
            {c.icon}
          </CardAction>
        ))}
      </span>
    );
  }
  return (
    <>
      {CHOICES.map((c) => (
        <Button
          key={c.key}
          variant={c.key === "discard" ? "danger" : c.key === "project" ? "primary" : "secondary"}
          title={c.title}
          disabled={busy}
          onClick={() => onPick(c.key)}
        >
          {c.label}
        </Button>
      ))}
    </>
  );
}
