/** How each composer mode dresses the editor and the bar. */

import type { ComposerMode } from "../../clientState";

export interface ModeUi {
  /** On the editor. */
  className: string;
  placeholder: (brandName: string) => string;
  /** The badge in the bar, when the mode has one. */
  badge: { className: string; label: string } | null;
}

/** The placeholder, whatever the mode, while there is no backend. */
export const DISCONNECTED_PLACEHOLDER = "Connecting to backend…";

export const MODE_UI: Record<ComposerMode, ModeUi> = {
  chat: {
    className: "",
    placeholder: (brandName) => `Message ${brandName} — / commands, @ files, $ shell`,
    badge: null,
  },
  command: {
    className: "mode-command",
    placeholder: () => "Command name (Backspace to return to chat)",
    badge: { className: "mode-badge command", label: "/ command" },
  },
  shell: {
    className: "mode-shell",
    placeholder: () => "Shell command (Backspace to return to chat)",
    badge: { className: "mode-badge", label: "$ shell" },
  },
};
