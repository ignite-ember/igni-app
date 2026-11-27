/**
 * The window's {@link TerminalManager}: made once, fed the connection's
 * pushes and states for as long as the window lives, and closed with it.
 * Held above the dock so hiding the terminal never ends a shell.
 */

import { useEffect, useRef } from "react";

import type { IgniClient } from "../../protocol/client";
import { TerminalManager } from "./terminalManager";
import { watchDocumentTheme } from "./xtermTheme";

export function useTerminals(
  client: Pick<IgniClient, "calls" | "onEvent" | "onStateChange">,
  connected: boolean,
): TerminalManager {
  const ref = useRef<TerminalManager | null>(null);
  ref.current ??= new TerminalManager(client.calls);
  const manager = ref.current;
  // Read when the subscription starts: after that the connection's own
  // events say.
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  useEffect(() => {
    const offEvent = client.onEvent((m) => manager.message(m));
    const offState = client.onStateChange((s) => {
      if (s === "connected") manager.connected();
      else manager.disconnected();
    });
    const offTheme = watchDocumentTheme(() => manager.retheme());
    if (connectedRef.current) manager.connected();
    return () => {
      offTheme();
      offState();
      offEvent();
      manager.dispose();
    };
  }, [client, manager]);

  return manager;
}
