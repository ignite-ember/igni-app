/**
 * Which session this window shows, and every way that changes: the
 * binding on connect, a pick from the sidebar, a folder attach, and the
 * rotations ``/clear`` and ``/fork`` make.
 *
 * Binding a view sets two things together — the client's session id
 * (what its requests carry) and ``ui.session`` (what the window model
 * and an extension see) — so they are only ever set here.
 */

import type { WindowModel } from "../clientState";
import type { IgniClient } from "../protocol/client";
import { AttachSessionResult, SessionIdReply } from "../protocol/rpcResults";
import type { Arrival } from "./arrival";
import type { HistoryLoader } from "./historyLoader";
import { planSessionBinding, type SessionBindingPlan } from "./sessionBinding";
import { SidebarLayout } from "./sidebarLayout";
import type { ShellPort } from "./shellPort";
import type { TranscriptView } from "./transcriptView";

export interface SessionSwitcherDeps {
  client: Pick<IgniClient, "rpc" | "sessionId">;
  windowModel: Pick<WindowModel, "get" | "write" | "hydrate" | "unset" | "closePanel">;
  view: TranscriptView;
  historyLoader: Pick<HistoryLoader, "load">;
  shell: Pick<ShellPort, "setSessions" | "refreshStatus" | "refreshSessions">;
}

/** Where a window is opened from: its ``?dir=`` and a link's page. */
export interface WindowOpening {
  wantedDir: string;
  arrival: Arrival | null;
}

export class SessionSwitcher {
  constructor(private readonly deps: SessionSwitcherDeps) {}

  /** On every connect: the window's model, then a session for it, then
   *  that session's history. Landing at the latest message is
   *  ``useTranscriptScroll``'s, once the list renders. */
  async bindOnConnect(opening: WindowOpening): Promise<void> {
    const { client, historyLoader, view } = this.deps;
    await this.restoreWindow(opening.arrival);
    // An already-bound session wins outright (a reconnect mid-session).
    if (!client.sessionId) await this.adopt(opening.wantedDir);
    this.bindTo(client.sessionId);
    view.restore(await historyLoader.load(client.sessionId));
  }

  /** Bind this view to ``id``, no ``switch_session`` RPC: the backend's
   *  pool resumes it lazily in its own runtime, so other tabs keep
   *  theirs. First contact can take seconds, hence the note. */
  async pick(id: string): Promise<void> {
    const { view, historyLoader, shell, windowModel } = this.deps;
    try {
      this.bindTo(id);
      const short = id.slice(0, 8);
      view.reset([view.chatItems.info(`Loading session ${short}…`)]);
      view.showHistory(await historyLoader.load(id), [view.chatItems.info(`Resumed session ${short}.`)]);
      void shell.refreshStatus();
    } catch (e) {
      view.error(String(e));
    }
    if (!SidebarLayout.opensAt(window.innerWidth)) {
      windowModel.write("sidebar", { ...windowModel.get("sidebar"), open: false });
    }
  }

  /** A fresh session whose tools and $-shell run in ``dir``; the
   *  binding persists with the session. */
  async attachFolder(dir: string): Promise<void> {
    const { view, shell, windowModel } = this.deps;
    windowModel.closePanel();
    try {
      const res = await this.attach({ project_dir: dir });
      this.bindTo(res.sessionId);
      view.reset();
      view.info(`Session locked to ${res.projectDir}`);
      void shell.refreshSessions();
      void shell.refreshStatus();
    } catch (e) {
      view.error(String(e));
    }
  }

  /** ``/clear`` renewed the runtime's session id: follow it. The sidebar
   *  gets an optimistic row, since the backend registers a session only
   *  on its first message; ``refreshSessions`` replaces it later. */
  async followRenewed(): Promise<void> {
    let renewed = "";
    try {
      renewed = SessionIdReply.parse(await this.deps.client.rpc<unknown>("get_session_id"));
    } catch {
      return;
    }
    if (!renewed) return;
    this.rotateTo(renewed);
    this.deps.shell.setSessions((prev) => [
      { session_id: renewed, name: "New chat" },
      ...prev.filter((s) => s.session_id !== renewed),
    ]);
  }

  /** ``/fork`` answered with ``newId``: continue there, with the cloned
   *  history before what the person added while it was in flight. */
  async followFork(newId: string): Promise<void> {
    const { view, historyLoader } = this.deps;
    this.rotateTo(newId);
    try {
      view.prependHistory(await historyLoader.load(newId));
    } catch (e) {
      view.error(`Loaded fork id but history fetch failed: ${e}`);
    }
  }

  private async adopt(wantedDir: string): Promise<void> {
    const { client, windowModel } = this.deps;
    const plan = planSessionBinding({
      wantedDir,
      storedSession: windowModel.get("session"),
      storedDir: windowModel.get("project_dir"),
    });
    const args = SessionSwitcher.attachArgs(plan);
    try {
      client.sessionId = args
        ? (await this.attach(args)).sessionId
        : await this.defaultSession();
    } catch {
      // An unusable binding falls through to the default session rather
      // than leaving the window dead.
      client.sessionId = await this.defaultSession();
    }
  }

  private static attachArgs(plan: SessionBindingPlan): Record<string, string> | null {
    switch (plan.kind) {
      case "bind-folder":
        return { project_dir: plan.projectDir };
      case "resume-in-folder":
        return { session_id: plan.sessionId, project_dir: plan.projectDir };
      case "resume":
        return { session_id: plan.sessionId };
      case "default":
        return null;
    }
  }

  private async attach(args: Record<string, string>): Promise<AttachSessionResult> {
    const res = AttachSessionResult.parse(await this.deps.client.rpc<unknown>("attach_session", args));
    this.deps.windowModel.write("project_dir", res.projectDir);
    return res;
  }

  private async defaultSession(): Promise<string> {
    return SessionIdReply.parse(await this.deps.client.rpc<unknown>("get_session_id"));
  }

  /** The page it was on, its sidebar and its draft come back with the
   *  model; a link wins over wherever the window last was. */
  private async restoreWindow(arrival: Arrival | null): Promise<void> {
    const { windowModel } = this.deps;
    await windowModel.hydrate();
    // Nothing stored for the sidebar: a wide window opens with it out.
    if (windowModel.unset().includes("sidebar")) {
      windowModel.write("sidebar", {
        ...windowModel.get("sidebar"),
        open: SidebarLayout.opensAt(window.innerWidth),
      });
    }
    if (arrival) {
      windowModel.write("route", [{ kind: arrival.page, label: arrival.page, params: arrival.params }]);
    }
    windowModel.write("focused", document.hasFocus());
  }

  private bindTo(id: string): void {
    this.deps.client.sessionId = id;
    this.deps.windowModel.write("session", id);
  }

  /** Move to a session that replaces this one, carrying the composer
   *  draft: the rotation lands a round trip after the click, and binding
   *  a session shows that session's draft — so anything typed in between
   *  would be blanked. A genuine switch still swaps the draft. */
  private rotateTo(to: string): void {
    const { client, windowModel } = this.deps;
    const from = client.sessionId;
    const draft = windowModel.get("composer");
    this.bindTo(to);
    // Forced: to this window's eye the draft is already showing.
    if (from && from !== to && draft.text) windowModel.write("composer", draft, { force: true });
  }
}
