import type { StatusUpdate } from "../protocol/messages";
import { BrandMark } from "./BrandMark";
import { FirstRunSetup } from "./FirstRunSetup";

/** What the empty chat offers, as the command each card runs. */
const WELCOME_CAPS: readonly { command: string; desc: string }[] = [
  {
    command: "/agents",
    desc: "Dispatch to a specialist — architect, debugger, …",
  },
  { command: "/skills", desc: "Workflows like /commit and /pr" },
  { command: "/workflows", desc: "Run a CC-style multi-phase workflow" },
  { command: "/schedule", desc: "Background tasks that report back" },
  { command: "/loop", desc: "Repeat a prompt across a batch until done" },
  { command: "/mcp", desc: "Plug in external tools and data sources" },
  { command: "/plugins", desc: "Install skills, agents and hooks" },
];

/**
 * The empty chat — the most-looked-at screen there is, so it is branded
 * the same way as the header. On a fresh install, where nothing below
 * works without a model, it leads with the setup.
 */
export function WelcomeScreen({
  groupName,
  groupMark,
  status,
  onLogin,
  onCommand,
}: {
  groupName: string;
  groupMark: string | null;
  status: StatusUpdate | null;
  onLogin: () => void;
  onCommand: (command: string) => void;
}) {
  return (
    <div className="conversation">
      <div className="col">
        <div className="welcome">
          <div className="welcome-mark">
            <BrandMark mark={groupMark} size={56} />
          </div>
          <h1>{groupName}</h1>
          <p>Your AI coding agent, in this project.</p>
          {status && !status.model_configured ? (
            <FirstRunSetup onLogin={onLogin} />
          ) : null}
          <div className="welcome-caps">
            {WELCOME_CAPS.map(({ command, desc }) => (
              <div
                key={command}
                className="welcome-cap"
                onClick={() => onCommand(command)}
              >
                <code>{command}</code>
                <span>{desc}</span>
              </div>
            ))}
          </div>
          <p className="welcome-hint">
            Enter to send · Shift+Enter newline · / commands · @ files · $ shell
          </p>
        </div>
      </div>
    </div>
  );
}
