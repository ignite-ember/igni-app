/**
 * One row of ``list_sessions``, and the sidebar entry it becomes.
 */

import type { SessionEntry } from "../components/Sidebar";
import { WirePayload } from "../protocol/wirePayload";

/** How a session's last activity reads in the sidebar. */
const WHEN_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

export class SessionRow {
  constructor(
    readonly sessionId: string,
    readonly name: string,
    /** Seconds since the epoch; ``0`` when unknown. */
    readonly updatedAt: number,
  ) {}

  static parse(raw: unknown): SessionRow {
    const p = new WirePayload(raw);
    const id = String(p.value("session_id") ?? p.value("id") ?? "");
    const ts = Number(p.value("updated_at") ?? p.value("created_at") ?? 0) || 0;
    return new SessionRow(id, p.text("name"), ts);
  }

  /** The rows of an answer: wrapped (``{sessions: [...]}``, as the
   *  backend sends it) or a bare list. */
  static listFrom(result: unknown): SessionRow[] {
    const rows = Array.isArray(result) ? result : new WirePayload(result).list("sessions");
    return rows.map((row) => SessionRow.parse(row));
  }

  /** Until auto-naming runs after the first turn, a readable time
   *  beats a hex id. */
  toEntry(): SessionEntry {
    const when = this.updatedAt
      ? new Date(this.updatedAt * 1000).toLocaleString([], WHEN_FORMAT)
      : "";
    return {
      session_id: this.sessionId,
      name: this.name || (when ? `Chat · ${when}` : this.sessionId),
      detail: [this.sessionId, when].filter(Boolean).join(" · "),
    };
  }
}
