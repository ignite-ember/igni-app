/**
 * The window's terminals, as tabs, living as long as the window rather
 * than as long as the pane that shows them.
 *
 * Hiding the dock only takes the pane away: every shell keeps running
 * and its xterm keeps taking output into its buffer, so showing the pane
 * again brings back the same tabs, scrollback and cursor. Each tab's
 * xterm draws into an element of its own, which the pane moves into its
 * host while the tab is the one shown. A shell ends when its tab is
 * closed, when it exits by itself, or with the connection (each tab then
 * gets a new shell on the next one); the window going closes them all.
 */

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import type { ServerMessage } from "../../protocol/messages";
import { TerminalSession, type TerminalCalls, type TerminalPhase } from "./terminalSession";
import { parseTerminalEvent } from "./terminalWire";
import { readXtermLook } from "./xtermTheme";

/** How long a refused new tab's message stays up. */
export const NOTICE_MS = 4000;

/** One tab as the pane draws it. */
export interface TerminalTabView {
  key: number;
  label: string;
  phase: TerminalPhase;
}

export interface TerminalsSnapshot {
  tabs: readonly TerminalTabView[];
  activeKey: number | null;
  /** A passing message: a new tab igni refused (the eight-terminal cap). */
  notice: string | null;
}

class TerminalTab {
  readonly element: HTMLDivElement;
  readonly term: Terminal;
  readonly fit = new FitAddon();
  readonly session: TerminalSession;
  phase: TerminalPhase = { kind: "idle" };
  opened = false;
  started = false;
  /** The size igni was last told. */
  sent: { cols: number; rows: number } | null = null;

  constructor(
    readonly key: number,
    calls: TerminalCalls,
    onPhase: (tab: TerminalTab, phase: TerminalPhase) => void,
    onData: (tab: TerminalTab, data: string) => void,
  ) {
    this.element = document.createElement("div");
    this.element.className = "terminal-screen";
    const look = readXtermLook();
    this.term = new Terminal({
      fontFamily: look.fontFamily,
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: look.theme,
    });
    this.term.loadAddon(this.fit);
    this.session = new TerminalSession(
      calls,
      {
        write: (text) => this.term.write(text),
        size: () => ({ cols: this.term.cols, rows: this.term.rows }),
      },
      (phase) => onPhase(this, phase),
    );
    this.term.onData((data) => onData(this, data));
  }

  shellName(): string {
    const shell = this.phase.kind === "open" ? this.phase.shell : this.lastShell;
    return shell ? shell.slice(shell.lastIndexOf("/") + 1) : "Terminal";
  }

  /** The shell the tab last ran, kept for its label after it ends. */
  lastShell = "";
}

/** Labels for tabs by shell name, numbering repeats: zsh, zsh 2, bash. */
export function numberedLabels(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} ${n}`;
  });
}

export class TerminalManager {
  private tabs: TerminalTab[] = [];
  private activeKey: number | null = null;
  private notice: string | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private nextKey = 1;
  private online = false;
  /** Whether a tab was ever made: the first showing opens one, later
   *  ones show what is there, even nothing. */
  private started = false;
  private listeners = new Set<() => void>();
  private snap: TerminalsSnapshot = { tabs: [], activeKey: null, notice: null };

  constructor(private readonly calls: TerminalCalls) {}

  // ── For React (useSyncExternalStore) ──────────────────────────────

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  readonly snapshot = (): TerminalsSnapshot => this.snap;

  // ── The connection ────────────────────────────────────────────────

  /** A server message; terminal pushes go to every tab, which keeps its own. */
  message(m: ServerMessage): void {
    const ev = parseTerminalEvent(m);
    if (ev) for (const tab of this.tabs) tab.session.event(ev);
  }

  connected(): void {
    this.online = true;
    for (const tab of this.tabs) if (tab.started) tab.session.connected();
  }

  disconnected(): void {
    this.online = false;
    for (const tab of this.tabs) tab.session.disconnected();
  }

  // ── Tabs ──────────────────────────────────────────────────────────

  /** Open the first tab the first time the pane is shown. */
  ensureStarted(): void {
    if (!this.started) this.newTab();
  }

  /** A new tab, shown; its shell opens once the pane has given it a size. */
  newTab(): number {
    this.started = true;
    const tab = new TerminalTab(
      this.nextKey++,
      this.calls,
      (t, phase) => this.phaseChanged(t, phase),
      (t, data) => t.session.input(data),
    );
    this.tabs.push(tab);
    this.activeKey = tab.key;
    this.changed();
    return tab.key;
  }

  activate(key: number): void {
    if (this.activeKey === key || !this.find(key)) return;
    this.activeKey = key;
    this.changed();
  }

  /** Close a tab and its shell. */
  closeTab(key: number): void {
    const at = this.tabs.findIndex((t) => t.key === key);
    if (at < 0) return;
    const [tab] = this.tabs.splice(at, 1);
    tab.session.dispose();
    tab.term.dispose();
    tab.element.remove();
    if (this.activeKey === key) {
      this.activeKey = (this.tabs[at] ?? this.tabs[at - 1])?.key ?? null;
    }
    this.changed();
  }

  restart(key: number): void {
    this.find(key)?.session.restart();
  }

  // ── The pane ──────────────────────────────────────────────────────

  /** Show the active tab in ``host``: open its xterm there the first
   *  time, start its shell, fit it and give it the keyboard. */
  attach(host: HTMLElement): void {
    const tab = this.active();
    if (!tab) {
      host.replaceChildren();
      return;
    }
    if (tab.element.parentElement !== host) host.replaceChildren(tab.element);
    if (!tab.opened) {
      tab.term.open(tab.element);
      tab.opened = true;
    }
    tab.fit.fit();
    if (!tab.started) {
      tab.started = true;
      tab.sent = { cols: tab.term.cols, rows: tab.term.rows };
      if (this.online) tab.session.connected();
    } else {
      this.sendSize(tab);
      tab.term.refresh(0, tab.term.rows - 1);
    }
    tab.term.focus();
  }

  /** Refit the shown tab to its host; tell igni the size when it changed. */
  fitActive(): void {
    const tab = this.active();
    if (!tab?.opened) return;
    tab.fit.fit();
  }

  /** Tell igni the shown tab's size, if it moved since it was last told. */
  settleActive(): void {
    const tab = this.active();
    if (tab?.opened) this.sendSize(tab);
  }

  /** Re-theme every tab, shown or not. */
  retheme(): void {
    const look = readXtermLook();
    for (const tab of this.tabs) {
      tab.term.options.theme = look.theme;
      tab.term.options.fontFamily = look.fontFamily;
    }
  }

  /** The window is going: end every shell. */
  dispose(): void {
    for (const tab of [...this.tabs]) {
      tab.session.dispose();
      tab.term.dispose();
    }
    this.tabs = [];
    this.activeKey = null;
    this.started = false;
    this.online = false;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    this.notice = null;
    this.changed();
  }

  private sendSize(tab: TerminalTab): void {
    const { cols, rows } = tab.term;
    if (tab.sent && tab.sent.cols === cols && tab.sent.rows === rows) return;
    tab.sent = { cols, rows };
    tab.session.resize(cols, rows);
  }

  private phaseChanged(tab: TerminalTab, phase: TerminalPhase): void {
    if (!this.find(tab.key)) return;
    tab.phase = phase;
    if (phase.kind === "open") tab.lastShell = phase.shell;
    // A new tab igni refused beside others (the cap on terminals per
    // window): drop it and say why for a moment, keeping the rest.
    if (
      phase.kind === "failed" &&
      phase.code === "refused" &&
      !tab.session.everOpened &&
      this.tabs.length > 1
    ) {
      this.showNotice(phase.message);
      this.closeTab(tab.key);
      return;
    }
    this.changed();
  }

  private showNotice(message: string): void {
    this.notice = message;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      this.notice = null;
      this.changed();
    }, NOTICE_MS);
  }

  private find(key: number): TerminalTab | undefined {
    return this.tabs.find((t) => t.key === key);
  }

  private active(): TerminalTab | undefined {
    return this.activeKey === null ? undefined : this.find(this.activeKey);
  }

  private changed(): void {
    const labels = numberedLabels(this.tabs.map((t) => t.shellName()));
    this.snap = {
      tabs: this.tabs.map((t, i) => ({ key: t.key, label: labels[i], phase: t.phase })),
      activeKey: this.activeKey,
      notice: this.notice,
    };
    for (const fn of this.listeners) fn();
  }
}
