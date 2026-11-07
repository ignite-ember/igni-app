/**
 * The four questions the shell asks its backend about itself: its
 * status, its folder, its sessions, and a fresh token count.
 *
 * Each answer is a typed result. A rejected call (the socket is down,
 * the backend predates the method, the tokenizer is not ready) is an
 * expected failure, so it comes back as a {@link Failure} carrying the
 * reason rather than as a throw every caller has to catch.
 */

import type { SessionEntry } from "../components/Sidebar";
import type { IgniClient } from "../protocol/client";
import type { Failure } from "../protocol/composerWire";
import type { StatusUpdate } from "../protocol/messages";
import { SessionRow } from "./sessionRow";

/** ``get_status``: ``null`` when the backend answered with nothing. */
export type StatusFetch = { ok: true; status: StatusUpdate | null } | Failure;

/** ``get_project_dir``: the folder this window's session is locked to. */
export type ProjectDirFetch = { ok: true; projectDir: string } | Failure;

/** ``list_sessions``, as the sidebar lists them. */
export type SessionListFetch = { ok: true; sessions: SessionEntry[] } | Failure;

/** ``count_context_tokens``: only whether it ran. */
export type TokenRecount = { ok: true } | Failure;

type Answer<T> = { ok: true; value: T } | Failure;

export class StatusSource {
  constructor(private readonly client: Pick<IgniClient, "rpc">) {}

  async status(): Promise<StatusFetch> {
    const r = await this.call("get_status", (raw) => (raw as StatusUpdate | null) ?? null);
    return r.ok ? { ok: true, status: r.value } : r;
  }

  async projectDir(): Promise<ProjectDirFetch> {
    const r = await this.call("get_project_dir", (raw) => raw as string);
    return r.ok ? { ok: true, projectDir: r.value } : r;
  }

  async sessions(): Promise<SessionListFetch> {
    const r = await this.call("list_sessions", (raw) =>
      SessionRow.listFrom(raw).map((row) => row.toEntry()),
    );
    return r.ok ? { ok: true, sessions: r.value } : r;
  }

  async recountTokens(): Promise<TokenRecount> {
    const r = await this.call("count_context_tokens", () => undefined);
    return r.ok ? { ok: true } : r;
  }

  /** The one place a rejection becomes a result; ``read`` runs inside
   *  it, so an answer that does not parse is a failure too. */
  private async call<T>(method: string, read: (raw: unknown) => T): Promise<Answer<T>> {
    try {
      return { ok: true, value: read(await this.client.rpc<unknown>(method)) };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }
}
