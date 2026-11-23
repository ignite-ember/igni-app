/**
 * The raw bytes of the file the viewer is showing, when it is an image
 * or a PDF — read through ``read_file_bytes`` (base64), the binary
 * sibling of ``read_file``. Same sandbox, a larger cap (10 MiB). Only
 * fetched for a kind that renders from bytes; ``""`` clears it.
 */

import { useEffect, useState } from "react";

import type { IgniClient } from "../../../protocol/client";

export interface FileBytes {
  path: string;
  /** Base64-encoded file bytes. */
  data: string;
  mediaType: string;
  size: number;
}

const EMPTY: FileBytes = { path: "", data: "", mediaType: "", size: 0 };

interface ReadFileBytesResp {
  path: string;
  data: string;
  size: number;
  media_type?: string;
  error?: string;
}

export interface LoadedBytes {
  bytes: FileBytes;
  loading: boolean;
  error: string;
}

export function useFileBytes(client: IgniClient, path: string): LoadedBytes {
  const [bytes, setBytes] = useState<FileBytes>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!path) {
      setBytes(EMPTY);
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void client
      .rpc<ReadFileBytesResp>("read_file_bytes", { path })
      .then((r) => {
        if (cancelled) return;
        if (r.error) {
          setError(r.error);
          setBytes(EMPTY);
          return;
        }
        setBytes({ path, data: r.data, mediaType: r.media_type ?? "", size: r.size });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setBytes(EMPTY);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, path]);

  return { bytes, loading, error };
}
