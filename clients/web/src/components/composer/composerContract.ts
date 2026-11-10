/**
 * What the composer's host hands it, grouped by concern, and the handle it
 * hands back.
 */

import type { SlashCommand } from "../../chat/slashCommands";
import type { PermissionMode } from "./permissionModes";
import type { ToolEntry } from "./popups";

/** What the `/` menu and the `/` button offer. */
export interface ComposerCatalog {
  skills: SlashCommand[];
  /** What the backend says exists, from `get_slash_commands`. `null`
   *  while it is still being fetched, or when the RPC is not there (an
   *  older backend) — the hardcoded list stands in. */
  backendCommands: SlashCommand[] | null;
  tools: ToolEntry[];
}

/** What the composer asks its host to do. */
export interface ComposerActions {
  onPickModel: (name: string) => void;
  onTool: (command: string) => void;
  /** The draft changed, in wire form, so other views can mirror it. */
  onTyping?: (wire: string) => void;
  onSubmit: (text: string) => void;
  onStop: () => void;
  /** A mode picked from the send button. The host fires the slash command
   *  that flips it; the picker is only a trigger. */
  onPickMode?: (mode: PermissionMode) => void;
}

/** What the host can do to a mounted composer. */
export interface ComposerHandle {
  /** After the host put text in the draft (a skill picked from a panel):
   *  close the menu, stop browsing history, and hand the person the caret
   *  at the end. */
  focusAtEnd: () => void;
}
