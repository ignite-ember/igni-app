/**
 * What the shell shows about its backend: the footer's status, the
 * sidebar's sessions, and whether anybody is signed in.
 *
 * Both are copies of what the host keeps (``chat.status``,
 * ``sessions.list``), held to render them: see ``viewState.allowlist.ts``.
 * The push channel writes them too, through the setters returned here.
 */

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { WindowModel } from "../clientState";
import type { SessionEntry } from "../components/Sidebar";
import type { StatusUpdate } from "../protocol/messages";
import type { StatusSource } from "./statusSource";

/** igni is self-hosted: a session with no account has nowhere to put
 *  anything. ``unknown`` until the first status arrives, so the wall
 *  does not flash at somebody who is signed in. */
export type AuthPhase = "unknown" | "signed-out" | "signed-in";

/** How often a connected window asks for its status. */
export const STATUS_POLL_MS = 5_000;

export interface ShellStatus {
  status: StatusUpdate | null;
  sessions: SessionEntry[];
  auth: AuthPhase;
  setStatus: Dispatch<SetStateAction<StatusUpdate | null>>;
  setSessions: Dispatch<SetStateAction<SessionEntry[]>>;
  /** Stable for the window's life. */
  refreshStatus: () => Promise<void>;
  /** Stable for the window's life. */
  refreshSessions: () => Promise<void>;
}

export function authPhaseOf(status: StatusUpdate | null): AuthPhase {
  if (status === null) return "unknown";
  return status.cloud_email ? "signed-in" : "signed-out";
}

export function useShellStatus(
  source: StatusSource,
  windowModel: Pick<WindowModel, "write">,
): ShellStatus {
  const [status, setStatus] = useState<StatusUpdate | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  // A failed refresh leaves the last answer showing.
  const refreshStatus = useCallback(async () => {
    const fetched = await source.status();
    if (fetched.ok && fetched.status) setStatus(fetched.status);
    const dir = await source.projectDir();
    if (dir.ok) windowModel.write("project_dir", dir.projectDir);
  }, [source, windowModel]);
  const refreshSessions = useCallback(async () => {
    const fetched = await source.sessions();
    if (fetched.ok) setSessions(fetched.sessions);
  }, [source]);

  return {
    status,
    sessions,
    auth: authPhaseOf(status),
    setStatus,
    setSessions,
    refreshStatus,
    refreshSessions,
  };
}

/** Ask for the status every {@link STATUS_POLL_MS} while connected. */
export function useStatusPoll(refreshStatus: () => Promise<void>, connected: boolean): void {
  useEffect(() => {
    if (!connected) return;
    const t = setInterval(refreshStatus, STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [connected, refreshStatus]);
}
