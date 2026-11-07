/** The background processes, live: seeded once from the backend's list,
 *  then kept current by the ``process_*`` push channels. No polling.
 *  Each caller holds its own table and subscription. */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { IgniClient } from "../../../protocol/client";
import { ProcessTable } from "./processTable";
import { ListedProcess, parseProcessEvent } from "./processWire";

export interface LiveProcesses {
  table: ProcessTable;
  setTable: Dispatch<SetStateAction<ProcessTable>>;
  /** Why the list could not be read, or ``""``. */
  loadError: string;
}

export function errorReason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface ProcessTableOptions {
  /** Buffer each process's output. Off for callers that only count rows,
   *  so a chatty process costs them nothing: ``process_line`` is ignored
   *  and no log or ``lastLine`` is kept. Defaults to on. */
  logs?: boolean;
}

export function useProcessTable(client: IgniClient, { logs = true }: ProcessTableOptions = {}): LiveProcesses {
  const [table, setTable] = useState(ProcessTable.EMPTY);
  const [loadError, setLoadError] = useState("");
  const tableRef = useRef(table);
  tableRef.current = table;

  useEffect(() => {
    let cancelled = false;
    const knownAtFetch = new Set(tableRef.current.rows.keys());
    void (async () => {
      try {
        const listed = ListedProcess.parseList(await client.rpc("list_background_processes"));
        if (cancelled) return;
        setTable((t) => t.seeded(listed, knownAtFetch, Date.now() / 1000));
        setLoadError("");
      } catch (e) {
        if (!cancelled) setLoadError(`Could not list the background processes: ${errorReason(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(
    () =>
      client.onEvent((m) => {
        const ev = parseProcessEvent(m);
        if (!ev || (!logs && ev.channel === "process_line")) return;
        setTable((t) => t.apply(ev));
      }),
    [client, logs],
  );

  return { table, setTable, loadError };
}
