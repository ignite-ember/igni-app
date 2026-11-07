/**
 * The answers {@link BackendCalls} reads, parsed at the boundary through
 * {@link WirePayload} so a field the backend left out reads as its
 * fallback rather than as ``undefined`` somewhere downstream.
 */

import { WirePayload } from "./wirePayload";

/** ``complete_files``: the @-mention candidates, and how many matched. */
export class FileCompletions {
  constructor(
    readonly matches: string[],
    readonly total: number,
  ) {}

  static parse(raw: unknown): FileCompletions {
    const p = new WirePayload(raw);
    const matches = p.list("matches").filter((m): m is string => typeof m === "string");
    return new FileCompletions(matches, p.number("total"));
  }
}

/** One ``search_chat`` hit. */
export class ChatSearchMatch {
  constructor(
    /** Position in ``get_chat_history``'s output; caller maps to its
     *  in-memory items index via the parallel mapping. */
    readonly historyIndex: number,
    readonly role: "user" | "assistant" | string,
    readonly runId: string,
    /** Snippet from the matched turn's content with ellipses on the
     *  trimmed ends. UTF-16 / surrogate-safe by construction. */
    readonly snippet: string,
    /** Match offset within ``snippet`` (not the full content). */
    readonly matchStart: number,
    readonly matchEnd: number,
    /** Epoch seconds (Agno-issued); 0 if the turn pre-dates the
     *  ``created_at`` field. Formatted to a relative or locale-time
     *  string per result row on the FE. */
    readonly createdAt: number,
  ) {}

  /** Every hit in the answer; a non-list answer is none. */
  static parseList(raw: unknown): ChatSearchMatch[] {
    const rows = Array.isArray(raw) ? raw : [];
    return rows.filter(WirePayload.isRecord).map((row) => {
      const p = new WirePayload(row);
      return new ChatSearchMatch(
        p.number("history_index"),
        p.string("role"),
        p.string("run_id"),
        p.string("snippet"),
        p.number("match_start"),
        p.number("match_end"),
        p.number("created_at"),
      );
    });
  }
}

/** ``run_shell``: a ``$`` line's captured output. */
export class ShellOutput {
  constructor(
    readonly output: string,
    readonly exitCode: number,
  ) {}

  static parse(raw: unknown): ShellOutput {
    const p = new WirePayload(raw);
    return new ShellOutput(p.string("output"), p.number("exit_code"));
  }
}

/** ``login``: whether the browser flow began. */
export class LoginStarted {
  constructor(readonly started: boolean) {}

  static parse(raw: unknown): LoginStarted {
    return new LoginStarted(new WirePayload(raw).flag("started"));
  }
}

/** ``approve_plan`` / ``dismiss_plan``: the decision the backend recorded. */
export class PlanDecision {
  constructor(
    readonly runId: string,
    readonly decision: string,
    readonly modeStatus: string,
  ) {}

  static parse(raw: unknown): PlanDecision {
    const p = new WirePayload(raw);
    return new PlanDecision(p.string("run_id"), p.string("decision"), p.string("mode_status"));
  }
}
