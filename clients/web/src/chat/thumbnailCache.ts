/**
 * The miniatures of the images a message carries, by path.
 *
 * The bytes come from ``read_file_bytes``; a miniature is read once and
 * kept, so scrolling back up the transcript does not read the file
 * again. A file that cannot be shown — too large, not an image, a read
 * that failed — is remembered as such, and is not read again either.
 */

import type { IgniClient } from "../protocol/client";

/** The largest file worth a miniature. */
export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

/** A miniature of an image, or the nothing that stands in for one. */
export interface Thumbnail {
  /** A data URL of the image; "" when the file cannot be shown. */
  url: string;
  /** The file's size in bytes. */
  size: number;
}

interface ReadFileBytesResp {
  path: string;
  data: string;
  size: number;
  media_type?: string;
  error?: string;
}

interface Entry {
  promise: Promise<Thumbnail>;
  value?: Thumbnail;
}

/** The miniatures this window has read, by path. */
export class ThumbnailCache {
  private readonly entries = new Map<string, Entry>();

  /** The miniature of `path`, read once. */
  load(path: string, client: IgniClient): Promise<Thumbnail> {
    const existing = this.entries.get(path);
    if (existing) return existing.promise;
    const entry: Entry = { promise: Promise.resolve({ url: "", size: 0 }) };
    entry.promise = this.read(path, client).then((value) => {
      entry.value = value;
      return value;
    });
    this.entries.set(path, entry);
    return entry.promise;
  }

  /** What is already known about `path`, without reading it. */
  peek(path: string): Thumbnail | undefined {
    return this.entries.get(path)?.value;
  }

  /** Forget everything — a new project starts over. */
  clear(): void {
    this.entries.clear();
  }

  /** The file's bytes as a miniature, or nothing when it cannot be one. */
  private async read(path: string, client: IgniClient): Promise<Thumbnail> {
    try {
      const res = await client.rpc<ReadFileBytesResp>("read_file_bytes", { path });
      const size = res.size ?? 0;
      if (res.error) return { url: "", size };
      const media = res.media_type ?? "";
      if (!media.startsWith("image/")) return { url: "", size };
      if (size > MAX_THUMBNAIL_BYTES) return { url: "", size };
      return { url: `data:${media};base64,${res.data}`, size };
    } catch {
      return { url: "", size: 0 };
    }
  }
}

/** The cache this window's miniatures are kept in. */
export const thumbnailCache = new ThumbnailCache();
