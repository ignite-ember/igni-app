/**
 * The project's files, fetched once as the flat list ``complete_files``
 * already serves (the same index the ``@``-mention picker uses), from
 * which {@link fileTree} derives every folder level.
 *
 * Capped on purpose: the index is best-first and large trees are cut to
 * {@link FILE_INDEX_LIMIT}, which is exactly the "some entries may not
 * be listed — keep typing to narrow" the viewer shows. ``total`` says
 * whether the cut happened.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { IgniClient } from "../../../protocol/client";

/** How many project paths to pull for the tree. Enough to browse any
 *  ordinary repo whole; a monorepo past this leans on the search box. */
export const FILE_INDEX_LIMIT = 4000;

interface FileCompletions {
  matches: string[];
  total: number;
}

export interface ProjectFiles {
  paths: string[];
  /** The project's total file count; greater than ``paths.length`` when
   *  the index was cut to the limit. */
  total: number;
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useProjectFiles(client: IgniClient, connected: boolean): ProjectFiles {
  const [index, setIndex] = useState<FileCompletions>({ matches: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    void client
      .rpc<FileCompletions>("complete_files", { query: "", limit: FILE_INDEX_LIMIT })
      .then((r) => {
        if (mounted.current) setIndex({ matches: r.matches ?? [], total: r.total ?? 0 });
      })
      .catch((e) => {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }, [client]);

  useEffect(() => {
    if (connected) reload();
  }, [connected, reload]);

  return { paths: index.matches, total: index.total, loading, error, reload };
}
