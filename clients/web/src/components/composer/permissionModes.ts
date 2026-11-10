/**
 * The backend's permission modes (`PermissionEvaluator.mode`), as the
 * send button's mode picker offers them.
 *
 * The names come from the wire contract (`protocol/messages.ts`), which
 * describes the same modes the backend's own `PermissionMode` enum
 * does. This file used to declare its own, narrower union — four of the
 * backend's five modes — and the two drifted: a session running
 * `dontAsk` was reported as "Execute", and the picker had nothing to
 * send for it.
 */

import { PERMISSION_MODE_NAMES, type PermissionModeName } from "../../protocol/messages";

/** The modes the picker offers. `dontAsk` is the fifth wire mode and is
 *  not among them: the backend enters it on its own (`--strict`, or an
 *  organisation's mode floor) and no slash command turns it on, so there
 *  is nothing for the picker to offer. */
export type PermissionMode = Exclude<PermissionModeName, "dontAsk">;

export interface PermissionModeOption {
  value: PermissionModeName;
  label: string;
  desc: string;
}

/** Every mode the backend can report, described. The table is checked
 *  against the contract's own union, so a mode added to the contract and
 *  left undescribed here is a type error rather than a silent fallback. */
const MODE_OPTIONS = {
  default: {
    value: "default",
    label: "Execute",
    desc: "Ask before each mutating tool. The safe default.",
  },
  plan: {
    value: "plan",
    label: "Plan",
    desc: "Read-only sandbox. Agent drafts a plan card; you approve before any edits run.",
  },
  acceptEdits: {
    value: "acceptEdits",
    label: "Auto-edit",
    desc: "Auto-approve file edits (Edit / Write / NotebookEdit). Shell + web tools still ask.",
  },
  bypassPermissions: {
    value: "bypassPermissions",
    label: "Bypass",
    desc: "Auto-approve every tool, including shell. Explicit deny rules in settings still block.",
  },
  dontAsk: {
    value: "dontAsk",
    label: "Don't ask",
    desc: "Deny by default: nothing runs without an explicit allow rule. Set by --strict or by an organisation's policy.",
  },
} as const satisfies Record<PermissionModeName, PermissionModeOption>;

/** The modes the picker offers, in the order it lists them. */
export const PERMISSION_MODES = [
  MODE_OPTIONS.default,
  MODE_OPTIONS.plan,
  MODE_OPTIONS.acceptEdits,
  MODE_OPTIONS.bypassPermissions,
] as const;

/** Whether the wire's string names a mode the contract knows. */
function isPermissionModeName(raw: string): raw is PermissionModeName {
  return (PERMISSION_MODE_NAMES as readonly string[]).includes(raw);
}

/**
 * The option for the mode the backend reports.
 *
 * `undefined` — the backend has not reported a mode yet (before the
 * first status): the picker's own default is shown. That is the choice
 * the picker starts on, not a claim about the backend.
 *
 * `null` — the wire names a mode this client does not know: surfaced as
 * unknown rather than read as the default, which would name a mode the
 * session is not in.
 */
export function permissionModeOption(raw?: string): PermissionModeOption | null {
  if (raw === undefined) return MODE_OPTIONS.default;
  if (!isPermissionModeName(raw)) return null;
  return MODE_OPTIONS[raw];
}

/** The slash command that turns each mode on, and the one that turns it
 *  off again. */
const MODE_COMMANDS: Record<Exclude<PermissionMode, "default">, { on: string; off: string }> = {
  plan: { on: "/plan on", off: "/plan off" },
  acceptEdits: { on: "/accept on", off: "/accept off" },
  bypassPermissions: { on: "/bypass on", off: "/bypass off" },
};

function isSwitchable(mode: string): mode is Exclude<PermissionMode, "default"> {
  return Object.prototype.hasOwnProperty.call(MODE_COMMANDS, mode);
}

/** What picking a mode asks of the backend. */
export type ModeSwitch =
  /** Send this command: it moves the backend to the picked mode. */
  | { readonly kind: "command"; readonly command: string }
  /** The backend already runs in the picked mode: nothing to send. */
  | { readonly kind: "unchanged" }
  /** The picked mode is out of reach from where the backend is now: it
   *  runs in a mode no command leaves. */
  | { readonly kind: "unreachable"; readonly from: string };

/**
 * What picking `next` asks of the backend, given the mode it reports now.
 *
 * Picking the mode already on is nothing. Picking a mode with a command
 * sends that command. Picking `default` turns off whichever mode is on,
 * which takes that mode's own command — and `dontAsk` has none, so from
 * there the composer cannot reach `default` and says so instead of
 * sending a command that would not move the mode.
 */
export function modeSwitch(current: string | undefined, next: PermissionMode): ModeSwitch {
  const from = current ?? "default";
  if (next === from) return { kind: "unchanged" };
  if (next !== "default") return { kind: "command", command: MODE_COMMANDS[next].on };
  if (isSwitchable(from)) return { kind: "command", command: MODE_COMMANDS[from].off };
  return { kind: "unreachable", from };
}
