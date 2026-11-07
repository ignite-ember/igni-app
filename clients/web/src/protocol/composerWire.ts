/**
 * The wire shapes of the RPCs the composer makes (`upload_attachment`,
 * `search_code`, `get_model_registry`), and the Results
 * {@link BackendCalls} turns them into.
 *
 * Each call's expected failures (a file too large, a backend error, a
 * call that threw) come back as `{ ok: false, reason }` rather than as a
 * rejection, so a caller decides whether to log or surface them and
 * never needs a catch of its own.
 */

import { WirePayload } from "./wirePayload";

/** Larger files should reach the project through the file system: base64
 *  over the WebSocket is wasteful for them. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** `upload_attachment`'s answer: where the file landed, or why not. */
export class UploadAttachmentResponse {
  constructor(
    readonly path: string,
    readonly error: string,
  ) {}

  static parse(raw: unknown): UploadAttachmentResponse {
    const p = new WirePayload(raw);
    return new UploadAttachmentResponse(p.string("path"), p.string("error"));
  }
}

/** One `search_code` row: where a pasted snippet was found. `end_line`
 *  is absent from older backends, which report only the start row. */
export interface CodeMatch {
  path: string;
  line: number;
  end_line?: number;
  preview: string;
}

/** `search_code`'s answer. A row without a path is dropped; no
 *  `matches` field is no matches. */
export class SearchCodeResponse {
  constructor(readonly matches: CodeMatch[]) {}

  static parse(raw: unknown): SearchCodeResponse {
    const matches: CodeMatch[] = [];
    for (const row of new WirePayload(raw).list("matches")) {
      const p = new WirePayload(row);
      const path = p.string("path");
      if (!path) continue;
      const endLine = p.optionalNumber("end_line");
      matches.push({
        path,
        line: p.number("line"),
        ...(endLine === undefined ? {} : { end_line: endLine }),
        preview: p.string("preview"),
      });
    }
    return new SearchCodeResponse(matches);
  }
}

/** `get_model_registry`'s answer: the model names, and the default. */
export class ModelRegistryResponse {
  constructor(
    readonly names: string[],
    readonly defaultName: string,
  ) {}

  /** Null when no registry came back at all. */
  static parse(raw: unknown): ModelRegistryResponse | null {
    const p = new WirePayload(raw);
    const registry = p.plainObject("registry");
    if (!registry) return null;
    return new ModelRegistryResponse(Object.keys(registry), p.string("default"));
  }

  /** The models sorted by name, the default marked. */
  choices(): ModelChoice[] {
    return [...this.names].sort().map((name) => ({ name, current: name === this.defaultName }));
  }
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
