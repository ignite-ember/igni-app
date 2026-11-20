/**
 * Tell the shell what this window has going on this computer — a run, an
 * approval waiting — while it is on the local side. The shell keeps it
 * for the switch's badge ("1 waiting on this computer") once the app is
 * on the cloud, and waits on it before a move to the cloud the
 * organisation asked for (design §4.1, §6.6). A window on the cloud
 * reports nothing: its runs are the VM's.
 */

import { useEffect } from "react";

import { host } from "../lib/host";
import { windowSide } from "./backendState";

export function useLocalActivity(sessionId: string, processing: boolean, approvals: number): void {
  useEffect(() => {
    if (host.kind !== "tauri" || windowSide() !== "local") return;
    host.reportLocalActivity({ session_id: sessionId, runs: processing ? 1 : 0, approvals });
  }, [sessionId, processing, approvals]);
}
