/**
 * The terminal: an interactive shell on igni's side — the local machine,
 * or the cloud VM the connection is relayed to — drawn by xterm in the
 * dock below the files, or on its own.
 *
 * {@link TerminalSession} decides when a shell opens and what its end
 * means; this binds it to xterm, to the connection and to the pane's
 * size. One terminal per window; closing the pane ends its shell.
 */

import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import type { IgniClient } from "../../protocol/client";
import { CloseIcon, ExpandIcon } from "../Icons";
import { TERMINAL_ATTR } from "./terminalKeys";
import { TerminalSession, type TerminalPhase } from "./terminalSession";
import { parseTerminalEvent } from "./terminalWire";
import { readXtermLook, watchDocumentTheme } from "./xtermTheme";

/** How long a resize settles before igni is told the new size. */
export const RESIZE_DEBOUNCE_MS = 120;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function TerminalPane({
  client,
  connected,
  maximized,
  onToggleMaximize,
  onClose,
}: {
  client: Pick<IgniClient, "calls" | "onEvent" | "onStateChange">;
  connected: boolean;
  maximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<TerminalPhase>({ kind: "idle" });
  const paneRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  // Read once, at mount: after that the connection's own events say.
  const connectedAtMount = useRef(connected);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const look = readXtermLook();
    const term = new Terminal({
      fontFamily: look.fontFamily,
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: look.theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const session = new TerminalSession(
      client.calls,
      {
        write: (text) => term.write(text),
        size: () => ({ cols: term.cols, rows: term.rows }),
      },
      setPhase,
    );
    sessionRef.current = session;
    const typed = term.onData((data) => session.input(data));
    const offEvent = client.onEvent((m) => {
      const ev = parseTerminalEvent(m);
      if (ev) session.event(ev);
    });
    const offState = client.onStateChange((s) => {
      if (s === "connected") session.connected();
      else session.disconnected();
    });
    const offTheme = watchDocumentTheme(() => {
      const next = readXtermLook();
      term.options.theme = next.theme;
      term.options.fontFamily = next.fontFamily;
    });

    // Fit to the pane as it is dragged (the dock's edge, the splitter,
    // full screen), and tell igni the new size once it settles.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sent = { cols: term.cols, rows: term.rows };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fit.fit();
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              if (term.cols === sent.cols && term.rows === sent.rows) return;
              sent = { cols: term.cols, rows: term.rows };
              session.resize(term.cols, term.rows);
            }, RESIZE_DEBOUNCE_MS);
          });
    observer?.observe(host);

    if (connectedAtMount.current) session.connected();
    term.focus();

    return () => {
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      offTheme();
      offState();
      offEvent();
      typed.dispose();
      session.dispose();
      sessionRef.current = null;
      term.dispose();
    };
  }, [client]);

  // The terminal owns the keyboard while it has focus: no key typed in
  // it reaches the window's shortcuts (Escape cancelling a run, ⌘F
  // opening the chat's find). xterm has already had the key by now.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    pane.addEventListener("keydown", stop);
    return () => pane.removeEventListener("keydown", stop);
  }, []);

  const restart = () => sessionRef.current?.restart();
  const label = phase.kind === "open" && phase.shell ? baseName(phase.shell) : "Terminal";

  return (
    <div className="terminal-pane" ref={paneRef} {...{ [TERMINAL_ATTR]: "" }}>
      <div className="files-dock-head terminal-head">
        <span className="terminal-title" title={phase.kind === "open" ? phase.cwd : undefined}>
          {label}
        </span>
        <span className="files-spacer" />
        <button
          className="files-dock-expand kb-icon-btn"
          title={maximized ? "Exit full screen" : "Full screen"}
          aria-label={maximized ? "Exit full screen" : "Full screen"}
          aria-pressed={maximized}
          onClick={onToggleMaximize}
        >
          <ExpandIcon size={14} full={maximized} />
        </button>
        <button className="files-dock-close kb-icon-btn" title="Close terminal" aria-label="Close terminal" onClick={onClose}>
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="terminal-host" ref={hostRef} />
      {phase.kind === "failed" && (
        <div className="terminal-notice" role="status">
          <span>{phase.message}</span>
          {!phase.final && (
            <button className="terminal-notice-btn" onClick={restart}>
              Try again
            </button>
          )}
        </div>
      )}
      {phase.kind === "exited" && (
        <div className="terminal-notice" role="status">
          <span>Press Enter to start a new shell.</span>
          <button className="terminal-notice-btn" onClick={restart}>
            New shell
          </button>
        </div>
      )}
    </div>
  );
}
