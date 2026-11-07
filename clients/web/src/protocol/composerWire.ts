/**
 * The wire shapes of the RPCs the composer makes (`upload_attachment`,
 * `search_code`, `get_model_registry`), and the Results
 * {@link IgniClient} turns them into.
 *
 * Each call's expected failures (a file too large, a backend error, a
 * call that threw) come back as `{ ok: false, reason }` rather than as a
 * rejection, so a caller decides whether to log or surface them and
 * never needs a catch of its own.
 */

/** Larger files should reach the project through the file system: base64
 *  over the WebSocket is wasteful for them. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** `upload_attachment`'s answer. */
export interface UploadAttachmentResponse {
  path?: string;
  size?: number;
  error?: string;
}

/** One `search_code` row: where a pasted snippet was found. `end_line`
 *  is absent from older backends, which report only the start row. */
export interface CodeMatch {
  path: string;
  line: number;
  end_line?: number;
  preview: string;
}

/** `search_code`'s answer. */
export interface SearchCodeResponse {
  matches?: CodeMatch[];
}

/** `get_model_registry`'s answer. */
export interface ModelRegistryResponse {
  registry: Record<string, unknown>;
  default: string;
}

/** A model the picker offers. */
export interface ModelChoice {
  name: string;
  current: boolean;
}

export interface Failure {
  ok: false;
  reason: string;
}

export type UploadResult = { ok: true; path: string } | Failure;

export type CodeSearchResult = { ok: true; matches: CodeMatch[] } | Failure;

/** `models` is sorted by name. */
export type ModelRegistryResult = { ok: true; models: ModelChoice[] } | Failure;

/** The reason a thrown call failed, as a string. */
export function failureReason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
