/**
 * The text of the file the viewer is showing, read through the same
 * ``read_file`` RPC the file-preview overlay uses. Read-only: the RPC is
 * sandboxed to the project and ``~/.igni``, refuses directories, and
 * caps the file at 256 KiB — the viewer only ever reads.
 */

import { useEffect, useState } from "react";

import type { IgniClient } from "../../../protocol/client";

export interface FileContents {
  path: string;
  contents: string;
  size: number;
  language: string;
}

const EMPTY: FileContents = { path: "", contents: "", size: 0, language: "" };

interface ReadFileResp {
  path: string;
  contents: string;
  size: number;
  language?: string;
  error?: string;
}

export interface LoadedFile {
  file: FileContents;
  loading: boolean;
  error: string;
}

/** Reads ``path`` whenever it changes; ``""`` clears to nothing. */
export function useFileContents(client: IgniClient, path: string): LoadedFile {
  const [file, setFile] = useState<FileContents>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!path) {
      setFile(EMPTY);
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void client
      .rpc<ReadFileResp>("read_file", { path })
      .then((r) => {
        if (cancelled) return;
        if (r.error) {
          setError(r.error);
          setFile(EMPTY);
          return;
        }
        // Report the path we asked for (project-relative), not the
        // backend's resolved absolute one, so the viewer can tell the
        // loaded file matches the active tab.
        setFile({ path, contents: r.contents, size: r.size, language: r.language ?? "" });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setFile(EMPTY);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, path]);

  return { file, loading, error };
}
