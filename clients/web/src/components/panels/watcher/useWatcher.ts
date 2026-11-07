/** The watcher page's data: the live processes, the one being read,
 *  fetching its tail, and killing processes. */

import { useState } from "react";
import type { IgniClient } from "../../../protocol/client";
import type { ProcessRow, ProcessTable } from "./processTable";
import { ProcessTail } from "./processWire";
import { errorReason, useProcessTable } from "./useProcessTable";

/** How many lines of history a newly selected process fetches. */
const TAIL_LINES = 500;

export interface Watcher {
  table: ProcessTable;
  /** The row being read, or ``null`` for the list. */
  selected: ProcessRow | null;
  loadError: string;
  /** Why the last tail fetch or kill failed, or ``""``. */
  actionError: string;
  /** Opens a row's log, or closes it when it is already open. */
  toggle: (pid: number) => void;
  deselect: () => void;
  kill: (pid: number) => void;
}

export function useWatcher(client: IgniClient): Watcher {
  const { table, setTable, loadError } = useProcessTable(client);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");

  const fetchTail = async (pid: number) => {
    try {
      const tail = ProcessTail.parse(await client.rpc("read_process_tail", { pid, tail: TAIL_LINES }));
      setTable((t) => t.withTail(pid, tail));
    } catch (e) {
      setActionError(`Could not read the output of PID ${pid}: ${errorReason(e)}`);
    }
  };

  const toggle = (pid: number) => {
    if (pid === selectedPid) {
      setSelectedPid(null);
      return;
    }
    setSelectedPid(pid);
    setActionError("");
    // Lines pushed since the panel opened are already buffered.
    if (table.logsOf(pid).length === 0) void fetchTail(pid);
  };

  const kill = async (pid: number) => {
    setActionError("");
    try {
      // The row flips when the backend pushes ``process_exited``.
      await client.rpc("stop_background_process", { pid });
    } catch (e) {
      setActionError(`Could not stop PID ${pid}: ${errorReason(e)}`);
    }
  };

  return {
    table,
    selected: selectedPid === null ? null : (table.rows.get(selectedPid) ?? null),
    loadError,
    actionError,
    toggle,
    deselect: () => setSelectedPid(null),
    kill: (pid) => void kill(pid),
  };
}
