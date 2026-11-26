/**
 * The dock to the right of the chat: the project's files, the terminal,
 * or both — the files on top and the terminal below a splitter, as in an
 * editor. The header's folder and terminal buttons open each.
 *
 * The dock owns what the two share: its width (dragged on the left
 * edge), full screen, and the split between them, each remembered per
 * device with the files' other preferences. The terminal keeps its
 * place in the tree while the files open and close above it, so its
 * shell is not restarted by them.
 */

import { useRef, useState } from "react";

import type { IgniClient } from "../protocol/client";
import { FilesDock } from "./FilesDock";
import { DOCK_MAX, DOCK_MIN, clampSplit, useFilesPrefs } from "./pages/files/useFilesPrefs";
import type { FilesSession } from "./pages/files/useFilesSession";
import { TerminalPane } from "./terminal/TerminalPane";

function dockLabel(filesOpen: boolean, terminalOpen: boolean): string {
  if (filesOpen && terminalOpen) return "Files and terminal";
  return terminalOpen ? "Terminal" : "Files";
}

export function SideDock({
  client,
  connected,
  filesSession,
  filesOpen,
  terminalOpen,
  onCloseFiles,
  onCloseTerminal,
}: {
  client: IgniClient;
  connected: boolean;
  filesSession: FilesSession;
  filesOpen: boolean;
  terminalOpen: boolean;
  onCloseFiles: () => void;
  onCloseTerminal: () => void;
}) {
  const prefs = useFilesPrefs();
  // Full screen: the dock takes the whole window and the chat (and the
  // sidebar) step aside. A view of the moment, not kept across a close.
  const [maximized, setMaximized] = useState(false);
  const dockRef = useRef<HTMLElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const split = filesOpen && terminalOpen;

  const toggleMaximize = () => {
    if (dockRef.current) dockRef.current.style.width = "";
    setMaximized((m) => !m);
  };

  // Drag the left edge to resize. Done on the element directly so a drag
  // is not a storm of state writes; the final width is saved on release.
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = dockRef.current?.offsetWidth ?? prefs.dockWidth;
    const move = (ev: PointerEvent) => {
      const w = Math.min(DOCK_MAX, Math.max(DOCK_MIN, startWidth + (startX - ev.clientX)));
      if (dockRef.current) dockRef.current.style.width = `${w}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      prefs.set("dockWidth", dockRef.current?.offsetWidth ?? prefs.dockWidth);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag the splitter between the files and the terminal, the same way:
  // the two shares move on the elements, and the last is saved on release.
  const onSplitStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const top = filesRef.current?.getBoundingClientRect().top ?? 0;
    const height =
      (filesRef.current?.offsetHeight ?? 0) + (terminalRef.current?.offsetHeight ?? 0);
    let share = prefs.dockSplit;
    const move = (ev: PointerEvent) => {
      if (height <= 0) return;
      share = clampSplit((ev.clientY - top) / height);
      if (filesRef.current) filesRef.current.style.flexGrow = String(share);
      if (terminalRef.current) terminalRef.current.style.flexGrow = String(1 - share);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      prefs.set("dockSplit", share);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside
      className={`files-dock${maximized ? " files-dock--full" : ""}`}
      ref={dockRef}
      style={maximized ? undefined : { width: prefs.dockWidth }}
      aria-label={dockLabel(filesOpen, terminalOpen)}
    >
      {!maximized && (
        <div
          className="files-dock-resize"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          onPointerDown={onResizeStart}
        />
      )}
      {filesOpen && (
        <div
          className="dock-section dock-section--files"
          ref={filesRef}
          style={{ flexGrow: split ? prefs.dockSplit : 1 }}
        >
          <FilesDock
            client={client}
            connected={connected}
            session={filesSession}
            prefs={prefs}
            maximized={maximized}
            onToggleMaximize={toggleMaximize}
            onClose={onCloseFiles}
          />
        </div>
      )}
      {split && (
        <div
          className="dock-split"
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize"
          onPointerDown={onSplitStart}
        />
      )}
      {terminalOpen && (
        <div
          className="dock-section dock-section--terminal"
          ref={terminalRef}
          style={{ flexGrow: split ? 1 - prefs.dockSplit : 1 }}
        >
          <TerminalPane
            client={client}
            connected={connected}
            maximized={maximized}
            onToggleMaximize={toggleMaximize}
            onClose={onCloseTerminal}
          />
        </div>
      )}
    </aside>
  );
}
