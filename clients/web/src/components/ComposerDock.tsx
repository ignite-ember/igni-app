import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import type { BackendSnapshot } from "../cloud/backendState";
import { chipLabel, chipTitle } from "../cloud/backendTexts";
import { ModeChip } from "./composer/ModeChip";
import type { PermissionMode } from "./composer/permissionModes";
import type { PermissionModeName, StatusUpdate } from "../protocol/messages";
import { BackendSwitch } from "./BackendSwitch";
import { CheckIcon, ChevronIcon, CloudIcon, FolderIcon } from "./Icons";
import { SessionContext, type SessionContextActions } from "./StatusBits";

/**
 * The row under the composer: where igni runs, and the folder it is
 * locked to — the two things a person changes most, kept next to what
 * they type rather than in the header or a menu. Mirrors the desktop
 * app's own "This computer / Choose folder" dock.
 *
 * The environment control appears only when the shell offers a cloud
 * side (`switchVisible`); on a local-only install there is nothing to
 * switch, so the row is just the folder.
 */
export function ComposerDock({
  backend,
  projectDir,
  onPickProject,
  sessionId,
  status,
  permissionMode,
  onPickMode,
  contextActions,
  busy,
}: {
  backend: BackendSnapshot | null;
  projectDir: string;
  onPickProject: () => void;
  sessionId: string;
  status: StatusUpdate | null;
  permissionMode?: PermissionModeName;
  onPickMode?: (mode: PermissionMode) => void;
  /** The context operations in the session readout. */
  contextActions?: SessionContextActions;
  /** A reply is running in the open chat. */
  busy?: boolean;
}) {
  // The folder is the VM's on the cloud side; there is no dialog for it.
  const folderReadOnly = backend?.side === "cloud";
  const folderName = projectDir ? projectDir.split("/").filter(Boolean).pop() || projectDir : "";
  const ctxPct = status ? Math.round((status.context_tokens / Math.max(status.max_context, 1)) * 100) : 0;

  const envIcon = backend?.side === "cloud" ? <CloudIcon size={14} /> : <ComputerIcon />;

  return (
    <div className="composer-dock">
      {/* Where igni runs. A menu to switch when the group offers both
          sides; otherwise a plain, read-only label so the person can
          still see which side was chosen for them. */}
      {backend &&
        (backend.switchVisible ? (
          <DockMenu label={chipLabel(backend)} title="Where igni runs" icon={envIcon}>
            <BackendSwitch backend={backend} />
          </DockMenu>
        ) : (
          <span className="dock-static" title={chipTitle(backend)}>
            {envIcon}
            <span className="dock-btn-label">{chipLabel(backend)}</span>
          </span>
        ))}
      {folderReadOnly ? (
        <button
          type="button"
          className="dock-btn"
          disabled
          title={`Your cloud igni's workspace${projectDir ? `: ${projectDir}` : ""}`}
        >
          <FolderIcon size={14} />
          <span className="dock-btn-label">{folderName || "workspace"}</span>
        </button>
      ) : (
        <DockMenu
          label={folderName || "Choose folder"}
          title={projectDir ? `Session locked to ${projectDir}` : "Lock this session to a project folder"}
          icon={<FolderIcon size={14} />}
        >
          {(close) => (
            <>
              <div className="popup-item dock-current" title={projectDir || undefined}>
                <span className="dock-check">{projectDir && <CheckIcon size={11} />}</span>
                <span className="dock-current-label">{projectDir ? folderName : "No folder"}</span>
              </div>
              <button
                type="button"
                className="popup-item dock-action"
                onClick={() => {
                  close();
                  onPickProject();
                }}
              >
                <span className="dock-check" />
                <span>Open folder…</span>
              </button>
            </>
          )}
        </DockMenu>
      )}
      <span className="composer-dock-end">
        <ModeChip permissionMode={permissionMode} onPickMode={onPickMode} />
        {status && (
          <SessionContext
            sessionId={sessionId}
            tokens={status.context_tokens}
            max={status.max_context}
            pct={ctxPct}
            actions={contextActions}
            busy={busy}
          />
        )}
      </span>
    </div>
  );
}

/** A button that opens a small menu above it, the way the account menu
 *  rises from the sidebar foot. Backdrop click and Escape close it. */
function DockMenu({
  label,
  title,
  icon,
  children,
}: {
  label: string;
  title: string;
  icon: ReactNode;
  /** The menu body, or a function given a ``close`` for items that act. */
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="dock-menu-wrap">
      <button
        ref={btnRef}
        type="button"
        className={`dock-btn${open ? " active" : ""}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span className="dock-btn-label">{label}</span>
        <ChevronIcon size={9} up={!open} down={open} />
      </button>
      {open && (
        <>
          <div className="dock-backdrop" onClick={close} />
          <div className="dropdown dock-menu" role="menu">
            {typeof children === "function" ? children(close) : children}
          </div>
        </>
      )}
    </div>
  );
}

/** A small laptop, for the "This computer" side. */
function ComputerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" style={{ display: "block" }}>
      <rect x="2.5" y="3" width="11" height="7.5" rx="1" />
      <path d="M1 13h14" strokeLinecap="round" />
    </svg>
  );
}
