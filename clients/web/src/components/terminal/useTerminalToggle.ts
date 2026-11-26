/**
 * Whether this window's terminal is open. Its own state rather than a
 * ``ui.panel``: a panel is one at a time, and the terminal opens beside
 * the files, not instead of them.
 */

import { useCallback, useMemo, useState } from "react";

export interface TerminalToggle {
  terminalOpen: boolean;
  toggleTerminal: () => void;
  closeTerminal: () => void;
}

export function useTerminalToggle(): TerminalToggle {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const toggleTerminal = useCallback(() => setTerminalOpen((open) => !open), []);
  const closeTerminal = useCallback(() => setTerminalOpen(false), []);
  return useMemo(
    () => ({ terminalOpen, toggleTerminal, closeTerminal }),
    [terminalOpen, toggleTerminal, closeTerminal],
  );
}
