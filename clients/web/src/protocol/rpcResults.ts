/**
 * The answers of the RPCs the app shell makes, read at the boundary.
 *
 * ``client.rpc<T>`` only names a type; it checks nothing. Each answer
 * here is parsed through {@link WirePayload} instead, so a field the
 * backend left out reads as its fallback rather than as ``undefined``
 * somewhere downstream.
 */

import type { ExtensionSummary } from "../extensions/ExtensionPage";
import { WirePayload } from "./wirePayload";

/** ``attach_session``: the session bound, and the folder it is locked to. */
export class AttachSessionResult {
  constructor(
    readonly sessionId: string,
    readonly projectDir: string,
  ) {}

  static parse(raw: unknown): AttachSessionResult {
    const p = new WirePayload(raw);
    return new AttachSessionResult(p.string("session_id"), p.string("project_dir"));
  }
}

/** ``get_cloud_plan``: the signed-in person, as the igni server knows them. */
export class CloudPlan {
  constructor(readonly fullName: string) {}

  static parse(raw: unknown): CloudPlan {
    return new CloudPlan(new WirePayload(raw).string("full_name"));
  }
}

/** ``pick_dir_native``: the backend's OS folder dialog. */
export class PickDirResult {
  constructor(
    readonly path: string,
    readonly cancelled: boolean,
    readonly error: string,
  ) {}

  static parse(raw: unknown): PickDirResult {
    const p = new WirePayload(raw);
    return new PickDirResult(p.string("path"), p.flag("cancelled"), p.string("error"));
  }
}

/** ``host_model``: an extension's host-object-model request, answered. */
export interface HostModelReply {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export const HostModelReply = {
  parse(raw: unknown): HostModelReply {
    const p = new WirePayload(raw);
    const error = p.plainObject("error");
    return {
      ok: p.flag("ok"),
      ...(p.value("result") !== undefined ? { result: p.value("result") } : {}),
      ...(error
        ? {
            error: {
              code: new WirePayload(error).string("code"),
              message: new WirePayload(error).string("message"),
            },
          }
        : {}),
    };
  },
};

/** ``extension_service_token``, in the shape the frame hands its page. */
export interface ServiceTokenReply {
  ok: boolean;
  token?: string;
  expiresIn?: number;
  error?: string;
}

export const ServiceTokenReply = {
  parse(raw: unknown): ServiceTokenReply {
    const p = new WirePayload(raw);
    return {
      ok: p.flag("ok"),
      token: p.optionalString("access_token"),
      expiresIn: p.optionalNumber("expires_in"),
      error: p.optionalString("error"),
    };
  },
};

/** ``run_workflow``: the run the card follows. */
export class RunWorkflowResult {
  constructor(
    readonly workflowRunId: string,
    readonly name: string,
  ) {}

  static parse(raw: unknown): RunWorkflowResult {
    const p = new WirePayload(raw);
    return new RunWorkflowResult(p.string("workflow_run_id"), p.string("name"));
  }
}

/** ``list_extensions``: what is installed. An entry without an id is
 *  dropped; the lists the nav and pages read are always lists. */
export class ListExtensionsResult {
  constructor(readonly extensions: ExtensionSummary[]) {}

  static parse(raw: unknown): ListExtensionsResult {
    const extensions: ExtensionSummary[] = [];
    for (const row of new WirePayload(raw).list("extensions")) {
      const summary = ListExtensionsResult.summary(row);
      if (summary) extensions.push(summary);
    }
    return new ListExtensionsResult(extensions);
  }

  private static summary(raw: unknown): ExtensionSummary | null {
    if (!WirePayload.isRecord(raw)) return null;
    const p = new WirePayload(raw);
    const id = p.string("id");
    if (!id) return null;
    return {
      // What only its own page reads (settings, problems, …) passes as sent.
      ...(raw as Partial<ExtensionSummary>),
      id,
      name: p.string("name", id),
      version: p.string("version"),
      state: p.string("state"),
      reason: p.string("reason"),
      origin: p.string("origin"),
      allow: p.list("allow").filter((a): a is string => typeof a === "string"),
      pages: p.list("pages").filter(WirePayload.isRecord).map((page) => {
        const q = new WirePayload(page);
        return { ...page, kind: q.string("kind"), label: q.string("label"), sidebar: q.flag("sidebar"), entry: q.string("entry") };
      }),
      menu: p.list("menu").filter(WirePayload.isRecord).map((entry) => {
        const q = new WirePayload(entry);
        return { ...entry, label: q.string("label"), command: q.string("command"), desc: q.string("desc") };
      }),
      indicators: p.list("indicators") as ExtensionSummary["indicators"],
      settings: p.list("settings") as ExtensionSummary["settings"],
      values: p.plainObject("values") ?? {},
    };
  }
}

/** ``get_session_id``: the session the backend binds a view to by
 *  default. Empty when the answer is not a string. */
export const SessionIdReply = {
  parse(raw: unknown): string {
    return typeof raw === "string" ? raw : "";
  },
};

/** ``count_context_tokens``: the session's real context size, or 0 when
 *  the tokenizer could not say. */
export const ContextTokenCount = {
  parse(raw: unknown): number {
    return typeof raw === "number" && raw > 0 ? raw : 0;
  },
};

/** ``truncate_history``: how many runs went, or why none did. */
export class TruncateHistoryResult {
  constructor(
    readonly removed: number,
    readonly error: string,
  ) {}

  static parse(raw: unknown): TruncateHistoryResult {
    const p = new WirePayload(raw);
    return new TruncateHistoryResult(p.number("removed"), p.string("error"));
  }
}

/** ``pop_pending_loop_iteration``: the next ``/loop`` prompt, empty
 *  when no loop is waiting (the backend answers ``null``). */
export class PendingLoopIteration {
  constructor(readonly prompt: string) {}

  static parse(raw: unknown): PendingLoopIteration {
    return new PendingLoopIteration(new WirePayload(raw).string("prompt"));
  }
}

/** One row of ``get_interrupted_runs``. */
export class InterruptedRun {
  constructor(
    readonly messageId: string,
    readonly content: string,
  ) {}

  /** Every row the backend sent that names a message; a non-list
   *  answer is no rows. */
  static parseList(raw: unknown): InterruptedRun[] {
    const rows = Array.isArray(raw) ? raw : [];
    return rows
      .map((row) => new WirePayload(row))
      .filter((p) => p.string("message_id") !== "")
      .map((p) => new InterruptedRun(p.string("message_id"), p.string("content")));
  }
}

/** ``dispatch_visualization_action``: what the backend recorded. */
export class VisualizationActionResult {
  constructor(
    readonly ok: boolean,
    readonly action: string,
    readonly params: unknown,
  ) {}

  static parse(raw: unknown): VisualizationActionResult {
    const p = new WirePayload(raw);
    return new VisualizationActionResult(p.flag("ok"), p.string("action"), p.value("params"));
  }
}
