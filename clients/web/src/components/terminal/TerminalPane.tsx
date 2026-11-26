/**
 * The terminal: interactive shells on igni's side — the local machine,
 * or the cloud VM the connection is relayed to — as tabs in the dock,
 * below the files or on their own.
 *
 * The shells and their xterms are the window's ({@link TerminalManager},
 * held in the App); this pane only shows them. Hiding it leaves every
 * shell running, and showing it again brings the tabs back as they were.
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import "@xterm/xterm/css/xterm.css";

import { CloseIcon, ExpandIcon, XIcon } from "../Icons";
import { TERMINAL_ATTR } from "./terminalKeys";
import type { TerminalManager } from "./terminalManager";

/** How long a resize settles before igni is told the new size. */
export const RESIZE_DEBOUNCE_MS = 120;

/** ⌃⇧` opens a new tab while the terminal has focus. */
function isNewTabKey(e: KeyboardEvent): boolean {
  return e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.code === "Backquote";
}

export function TerminalPane({
  terminals,
  maximized,
  onToggleMaximize,
  onClose,
}: {
  terminals: TerminalManager;
  maximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  const snap = useSyncExternalStore(terminals.subscribe, terminals.snapshot);
  const paneRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const active = snap.tabs.find((t) => t.key === snap.activeKey) ?? null;
  const hasActive = active !== null;

  // The first showing opens a terminal; later ones show what is there.
  // Before paint, so the empty state never flashes.
  useLayoutEffect(() => terminals.ensureStarted(), [terminals]);

  // Put the active tab's screen in the host, fitted, with the keyboard.
  useLayoutEffect(() => {
    if (hostRef.current) terminals.attach(hostRef.current);
  }, [terminals, snap.activeKey]);

  // Fit to the pane as it is dragged (the dock's edge, the splitter,
  // full screen), and tell igni the new size once it settles.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      terminals.fitActive();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        terminals.settleActive();
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(host);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [terminals, hasActive]);

  // The terminal owns the keyboard while it has focus: no key typed in
  // it reaches the window's shortcuts (Escape cancelling a run, ⌘F
  // opening the chat's find). xterm has already had the key by now,
  // except ⌃⇧`, taken first for a new tab.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    const newTab = (e: KeyboardEvent) => {
      if (!isNewTabKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      terminals.newTab();
    };
    pane.addEventListener("keydown", stop);
    pane.addEventListener("keydown", newTab, true);
    return () => {
      pane.removeEventListener("keydown", stop);
      pane.removeEventListener("keydown", newTab, true);
    };
  }, [terminals]);

  const phase = active?.phase;

  return (
    <div className="terminal-pane" ref={paneRef} {...{ [TERMINAL_ATTR]: "" }}>
      <div className="files-dock-head terminal-head">
        {/* The tabs and their close buttons sit side by side, and a
            tablist may hold only tabs: it owns the tabs by id instead. */}
        <div className="files-tabs">
          <div
            className="terminal-tablist"
            role="tablist"
            aria-label="Terminals"
            aria-owns={snap.tabs.map((t) => `terminal-tab-${t.key}`).join(" ") || undefined}
          />
          {snap.tabs.map((tab) => {
            const selected = tab.key === snap.activeKey;
            const exited = tab.phase.kind === "exited";
            return (
              <div
                key={tab.key}
                className={`files-tab terminal-tab${selected ? " is-active" : ""}${exited ? " is-exited" : ""}`}
                role="presentation"
              >
                <button
                  className="files-tab-label"
                  role="tab"
                  id={`terminal-tab-${tab.key}`}
                  aria-selected={selected}
                  aria-controls={selected ? "terminal-panel" : undefined}
                  onClick={() => terminals.activate(tab.key)}
                  title={tab.phase.kind === "open" ? tab.phase.cwd : tab.label}
                >
                  {tab.label}
                  {exited && <span className="terminal-tab-exited"> exited</span>}
                </button>
                <button
                  className="files-tab-close kb-icon-btn"
                  title="Close"
                  aria-label={`Close terminal ${tab.label}`}
                  onClick={() => terminals.closeTab(tab.key)}
                >
                  <XIcon size={10} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          className="files-dock-expand kb-icon-btn"
          title="New terminal (⌃⇧`)"
          aria-label="New terminal"
          onClick={() => terminals.newTab()}
        >
          <span className="terminal-plus" aria-hidden="true">+</span>
        </button>
        <button
          className="files-dock-expand kb-icon-btn"
          title={maximized ? "Exit full screen" : "Full screen"}
          aria-label={maximized ? "Exit full screen" : "Full screen"}
          aria-pressed={maximized}
          onClick={onToggleMaximize}
        >
          <ExpandIcon size={14} full={maximized} />
        </button>
        <button className="files-dock-close kb-icon-btn" title="Hide terminal" aria-label="Hide terminal" onClick={onClose}>
          <CloseIcon size={14} />
        </button>
      </div>
      {active ? (
        <div
          className="terminal-host"
          ref={hostRef}
          role="tabpanel"
          id="terminal-panel"
          aria-labelledby={`terminal-tab-${active.key}`}
        />
      ) : (
        <div className="terminal-empty">
          <span>No terminals open.</span>
          <button className="terminal-notice-btn" onClick={() => terminals.newTab()}>
            New terminal
          </button>
        </div>
      )}
      {snap.notice && (
        <div className="terminal-notice" role="status">
          <span>{snap.notice}</span>
        </div>
      )}
      {active && phase?.kind === "failed" && (
        <div className="terminal-notice" role="status">
          <span>{phase.message}</span>
          {!phase.final && (
            <button className="terminal-notice-btn" onClick={() => terminals.restart(active.key)}>
              Try again
            </button>
          )}
        </div>
      )}
      {active && phase?.kind === "exited" && (
        <div className="terminal-notice" role="status">
          <span>Press Enter to start a new shell.</span>
          <button className="terminal-notice-btn" onClick={() => terminals.restart(active.key)}>
            New shell
          </button>
        </div>
      )}
    </div>
  );
}
