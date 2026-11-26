/**
 * Files — a read-only view of the project, docked as a split beside the
 * chat rather than taking it over ({@link SideDock} holds it, above the
 * terminal when that is open too). The header's folder button opens and
 * closes it; a changed file opens here in place, and several stay open
 * as tabs.
 *
 * The tabs, the active file and each file's scroll live in
 * {@link FilesSession}, above this component, so closing the dock keeps
 * them — only a different project starts over. Nothing here writes: the
 * tree is the flat index ``complete_files`` already serves, the text
 * comes through the sandboxed, size-capped ``read_file``, and the panes
 * only render.
 */

import { useEffect, useRef, useState } from "react";

import { host } from "../lib/host";
import type { IgniClient } from "../protocol/client";
import { CloseIcon, ExpandIcon, ListTreeIcon, MoreIcon, XIcon } from "./Icons";
import { isTerminalKey } from "./terminal/terminalKeys";
import { FileNavigator } from "./pages/files/FileNavigator";
import { FileViewer } from "./pages/files/FileViewer";
import { classify, isReadable } from "./pages/files/fileKind";
import { TAB_SIZES, type PrefsControl } from "./pages/files/useFilesPrefs";
import type { FilesSession } from "./pages/files/useFilesSession";
import { useFileBytes } from "./pages/files/useFileBytes";
import { useFileContents } from "./pages/files/useFileContents";
import { useProjectFiles } from "./pages/files/useProjectFiles";

function isGoToFile(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "p" || e.key === "P");
}

function isToggleTree(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "y" || e.key === "Y");
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function FilesDock({
  client,
  connected,
  session,
  prefs,
  maximized,
  onToggleMaximize,
  onClose,
}: {
  client: IgniClient;
  connected: boolean;
  session: FilesSession;
  /** The dock's preferences, held by {@link SideDock} so the two share one copy. */
  prefs: PrefsControl;
  maximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  const project = useProjectFiles(client, connected);
  const { tabs, activePath, query } = session;

  const [menuOpen, setMenuOpen] = useState(false);
  // Only text and markdown are read; a binary file (image, PDF) would
  // come back as mojibake, so it is not even fetched.
  const activeKind = classify(activePath);
  const loaded = useFileContents(client, isReadable(activeKind) ? activePath : "");
  // An image or a PDF is read as bytes and rendered inline.
  const bytesKind = activeKind === "image" || activeKind === "pdf";
  const loadedBytes = useFileBytes(client, bytesKind ? activePath : "");
  const searchRef = useRef<HTMLInputElement>(null);

  const focusFinder = () => {
    if (!prefs.treeOpen) prefs.set("treeOpen", true);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  // The dock's own shortcuts while it is open. ⌘F is left to the chat's
  // find; Esc only closes the ⋯ menu, never the whole split. A key typed
  // in the terminal is the shell's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalKey(e)) return;
      if (menuOpen && e.key === "Escape") {
        setMenuOpen(false);
        e.stopPropagation();
        return;
      }
      if (isGoToFile(e)) {
        e.preventDefault();
        focusFinder();
      } else if (isToggleTree(e)) {
        e.preventDefault();
        prefs.set("treeOpen", !prefs.treeOpen);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const empty = project.loading
    ? "Loading the project's files…"
    : project.paths.length === 0
      ? "No files here yet."
      : "Pick a file from the tree to read it.";

  const cycleTab = () => {
    const i = TAB_SIZES.indexOf(prefs.tabSize as (typeof TAB_SIZES)[number]);
    prefs.set("tabSize", TAB_SIZES[(i + 1) % TAB_SIZES.length]);
  };

  return (
    <>
      <div className="files-dock-head">
        <div className="files-tabs" role="tablist" aria-label="Open files">
          {tabs.map((path) => (
            <div
              key={path}
              className={`files-tab${path === activePath ? " is-active" : ""}`}
              role="tab"
              aria-selected={path === activePath}
            >
              <button className="files-tab-label" onClick={() => session.setActive(path)} title={path}>
                {baseName(path)}
              </button>
              <button
                className="files-tab-close kb-icon-btn"
                title="Close"
                aria-label={`Close ${baseName(path)}`}
                onClick={() => session.close(path)}
              >
                <XIcon size={10} />
              </button>
            </div>
          ))}
        </div>
        <button
          className="files-dock-expand kb-icon-btn"
          title={maximized ? "Exit full screen" : "Full screen"}
          aria-label={maximized ? "Exit full screen" : "Full screen"}
          aria-pressed={maximized}
          onClick={onToggleMaximize}
        >
          <ExpandIcon size={14} full={maximized} />
        </button>
        <button className="files-dock-close kb-icon-btn" title="Close Files" aria-label="Close Files" onClick={onClose}>
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="files-subhead">
        <span className="files-subhead-name" title={activePath}>
          {activePath ? baseName(activePath) : "Files"}
        </span>
        <span className="files-spacer" />
        {activePath && <span className="files-readonly">Read-only</span>}
        {activeKind === "markdown" && (
          <button
            className="files-md-toggle"
            title={prefs.renderMarkdown ? "Show markdown source" : "Show rendered markdown"}
            onClick={() => prefs.set("renderMarkdown", !prefs.renderMarkdown)}
          >
            {prefs.renderMarkdown ? "Source" : "Preview"}
          </button>
        )}
        <span className="files-subhead-sep" aria-hidden="true" />
        <button
          className={`kb-icon-btn${prefs.treeOpen ? " is-on" : ""}`}
          title={prefs.treeOpen ? "Hide file tree (⇧⌘Y)" : "Show file tree (⇧⌘Y)"}
          aria-label="Toggle file tree"
          aria-pressed={prefs.treeOpen}
          onClick={() => prefs.set("treeOpen", !prefs.treeOpen)}
        >
          <ListTreeIcon size={15} />
        </button>
        <div className="files-menu-anchor">
          <button
            className={`kb-icon-btn${menuOpen ? " is-on" : ""}`}
            title="More"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MoreIcon size={16} />
          </button>
          {menuOpen && (
            <>
              <div className="files-menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="files-menu overflow-list" role="menu">
                <button className="files-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); focusFinder(); }}>
                  <span>Go to file or search</span>
                  <kbd>⌘P</kbd>
                </button>
                <button
                  className="files-menu-item"
                  role="menuitem"
                  onClick={() => { prefs.set("treeOpen", !prefs.treeOpen); setMenuOpen(false); }}
                >
                  <span>{prefs.treeOpen ? "Hide file tree" : "Show file tree"}</span>
                  <kbd>⇧⌘Y</kbd>
                </button>
                <button
                  className="files-menu-item"
                  role="menuitem"
                  onClick={() => prefs.set("treeSide", prefs.treeSide === "right" ? "left" : "right")}
                >
                  <span>File tree position</span>
                  <span className="files-menu-value">{prefs.treeSide === "right" ? "Right" : "Left"}</span>
                </button>
                <button
                  className="files-menu-item"
                  role="menuitem"
                  onClick={() => { session.setQuery(""); focusFinder(); setMenuOpen(false); }}
                >
                  <span>Go to project root</span>
                </button>
                <div className="files-menu-sep" role="separator" />
                <button
                  className="files-menu-item"
                  role="menuitemcheckbox"
                  aria-checked={prefs.wordWrap}
                  onClick={() => prefs.set("wordWrap", !prefs.wordWrap)}
                >
                  <span>Word wrap</span>
                  {prefs.wordWrap && <span className="files-menu-check" aria-hidden="true">✓</span>}
                </button>
                <button className="files-menu-item" role="menuitem" onClick={cycleTab}>
                  <span>Tab size</span>
                  <span className="files-menu-value">{prefs.tabSize}</span>
                </button>
                <div className="files-menu-sep" role="separator" />
                <button
                  className="files-menu-item"
                  role="menuitem"
                  onClick={() => { project.reload(); setMenuOpen(false); }}
                >
                  <span>Refresh file list</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="files-layout" data-side={prefs.treeOpen ? prefs.treeSide : "none"}>
        <div className="files-viewer-wrap">
          <FileViewer
            path={activePath}
            file={loaded.file}
            loading={loaded.loading}
            error={loaded.error}
            wordWrap={prefs.wordWrap}
            tabSize={prefs.tabSize}
            renderMarkdown={prefs.renderMarkdown}
            empty={empty}
            scrollMemory={session.scrollMemory}
            bytes={loadedBytes.bytes}
            bytesLoading={loadedBytes.loading}
            bytesError={loadedBytes.error}
            onOpenFile={session.open}
            onOpenExternally={
              activePath && host.canOpenNatively ? () => void host.openFile(activePath) : undefined
            }
          />
        </div>
        {prefs.treeOpen && (
          <FileNavigator
            paths={project.paths}
            total={project.total}
            loading={project.loading}
            error={project.error}
            value={query}
            onChange={session.setQuery}
            onOpenFile={session.open}
            activePath={activePath}
            inputRef={searchRef}
          />
        )}
      </div>
    </>
  );
}
