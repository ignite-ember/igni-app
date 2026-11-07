/**
 * The socket's lifecycle for this window: connect on mount, bind a
 * session on every connect (``SessionSwitcher.bindOnConnect``), and
 * follow an extension that moves the window to another session.
 *
 * ``sessionBound`` gates the composer as well as the socket: binding a
 * session shows that session's draft (the backend pushes it), so
 * anything typed before the binding would be replaced by it.
 */

import { useEffect, useState } from "react";

import type { WindowModel } from "../clientState";
import type { ConnectionState, IgniClient } from "../protocol/client";
import type { SessionSwitcher, WindowOpening } from "./sessionSwitcher";

export interface SessionBindingState {
  conn: ConnectionState;
  sessionBound: boolean;
}

export interface SessionBindingDeps {
  client: Pick<IgniClient, "onStateChange" | "connect" | "close" | "sessionId">;
  windowModel: Pick<WindowModel, "onRemote">;
  sessions: SessionSwitcher;
  /** Read once per window; must keep its identity. */
  opening: WindowOpening;
  /** After each binding, bound or not: what the window asks the session
   *  for. Must keep its identity. */
  onBound: () => Promise<void>;
}

export function useSessionBinding(deps: SessionBindingDeps): SessionBindingState {
  const { client, windowModel, sessions, opening, onBound } = deps;
  const [conn, setConn] = useState<ConnectionState>("connecting");
  const [sessionBound, setSessionBound] = useState(false);

  useEffect(() => {
    const bind = async () => {
      try {
        await sessions.bindOnConnect(opening);
      } catch {
        /* working with what it has */
      }
      // Bound, or failed to: either way nothing will replace the draft now.
      setSessionBound(true);
      await onBound();
    };
    const off = client.onStateChange((s) => {
      setConn(s);
      if (s === "connected") void bind();
      else setSessionBound(false);
    });
    client.connect();
    return () => {
      off();
      client.close();
    };
  }, [client, sessions, opening, onBound]);

  // An extension moved this window (``host.sessions.current``): a
  // session has a transcript to load, which is what picking it does.
  useEffect(
    () =>
      windowModel.onRemote((change) => {
        const id = change.field === "session" ? String(change.value ?? "") : "";
        if (id && id !== client.sessionId) void sessions.pick(id);
      }),
    [windowModel, client, sessions],
  );

  return { conn, sessionBound };
}
