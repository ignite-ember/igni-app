/**
 * The backend's permission modes (`PermissionEvaluator.mode`), as the
 * send button's mode picker offers them.
 */

export type PermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions";

export interface PermissionModeOption {
  value: PermissionMode;
  label: string;
  desc: string;
}

export const PERMISSION_MODES: readonly PermissionModeOption[] = [
  {
    value: "default",
    label: "Execute",
    desc: "Ask before each mutating tool. The safe default.",
  },
  {
    value: "plan",
    label: "Plan",
    desc: "Read-only sandbox. Agent drafts a plan card; you approve before any edits run.",
  },
  {
    value: "acceptEdits",
    label: "Auto-edit",
    desc: "Auto-approve file edits (Edit / Write / NotebookEdit). Shell + web tools still ask.",
  },
  {
    value: "bypassPermissions",
    label: "Bypass",
    desc: "Auto-approve every tool, including shell. Explicit deny rules in settings still block.",
  },
];

/** The option for the mode the backend reports. The wire carries a plain
 *  string; anything this client does not know reads as the default. */
export function permissionModeOption(raw?: string): PermissionModeOption {
  return PERMISSION_MODES.find((m) => m.value === raw) ?? PERMISSION_MODES[0];
}

/** The slash command that turns each non-default mode on and off. */
const MODE_COMMANDS: Record<Exclude<PermissionMode, "default">, { on: string; off: string }> = {
  plan: { on: "/plan on", off: "/plan off" },
  acceptEdits: { on: "/accept on", off: "/accept off" },
  bypassPermissions: { on: "/bypass on", off: "/bypass off" },
};

function isSwitchable(mode: string): mode is Exclude<PermissionMode, "default"> {
  return Object.prototype.hasOwnProperty.call(MODE_COMMANDS, mode);
}

/**
 * The command that moves the backend from `current` to `next`, or
 * `null` when there is nothing to do. Picking `default` turns off
 * whichever mode is on; picking the mode already on is nothing.
 */
export function modeSwitchCommand(current: string, next: PermissionMode): string | null {
  if (next === current) return null;
  if (next !== "default") return MODE_COMMANDS[next].on;
  return isSwitchable(current) ? MODE_COMMANDS[current].off : null;
}
