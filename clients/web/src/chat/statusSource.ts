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

/** Who is signed in on this computer: the status fields that name the
 *  account. On the desktop's cloud side they are this computer's, not
 *  the VM's: the VM's igni runs on its own credential and names nobody
 *  (``cloud_email`` is empty there), and the sign-in wall and the
 *  account menu belong to this computer's backend (design §6.4). */
export const ACCOUNT_FIELDS = ["cloud_email", "cloud_name", "cloud_org", "cloud_connected"] as const;
export type AccountFields = Partial<Pick<StatusUpdate, (typeof ACCOUNT_FIELDS)[number]>>;
export type AccountFetch = { ok: true; account: AccountFields } | Failure;

/** ``get_status`` on this computer's backend, through the shell's
 *  ``account_rpc``; ``null`` when the window is not on the cloud side. */
export type AccountStatusCall = () => Promise<unknown> | null;

type Answer<T> = { ok: true; value: T } | Failure;

export class StatusSource {
  constructor(
    private readonly client: Pick<IgniClient, "rpc">,
    /** Set on the desktop's cloud side: where the account fields come from. */
    private readonly accountStatus?: AccountStatusCall,
  ) {}

  /** Whether the account fields come from this computer rather than the
   *  window's own backend. */
  get accountElsewhere(): boolean {
    return this.accountStatus !== undefined;
  }

  /** This computer's account fields, or ``null`` when the window's own
   *  backend names its account (not on the cloud side). */
  async account(): Promise<AccountFetch | null> {
    const call = this.accountStatus?.();
    if (!call) return null;
    try {
      const raw = (await call) as Record<string, unknown> | null;
      const account: AccountFields = {};
      for (const key of ACCOUNT_FIELDS) {
        if (raw && key in raw) (account as Record<string, unknown>)[key] = raw[key];
      }
      return { ok: true, account };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

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
