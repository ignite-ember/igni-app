/**
 * What a bound window asks its session for, in order: a fresh token
 * count, then its status and sessions, then the command catalog, then a
 * silent update check.
 */

import type { StatusSource } from "./statusSource";

export interface SessionStartupDeps {
  source: Pick<StatusSource, "recountTokens">;
  refreshStatus: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadCatalog: () => Promise<void>;
  /** ``silent`` says nothing when there is no update. */
  checkUpdate: (silent: boolean) => Promise<void>;
}

export class SessionStartup {
  constructor(private readonly deps: SessionStartupDeps) {}

  /**
   * Arrow-bound: ``useSessionBinding`` holds it as an effect dependency.
   *
   * Re-tokenised first, so the footer does not start from a count an
   * older run inflated. The recount's result is not read: a tokenizer
   * that is not ready leaves the old count, and the rest goes on.
   */
  run = async (): Promise<void> => {
    const { source, refreshStatus, refreshSessions, loadCatalog, checkUpdate } = this.deps;
    await source.recountTokens();
    void refreshStatus();
    void refreshSessions();
    await loadCatalog();
    void checkUpdate(true);
  };
}
