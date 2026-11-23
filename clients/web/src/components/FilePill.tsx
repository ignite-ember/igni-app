import { useEffect, useRef, useState } from "react";
import { FileTypeIcon } from "./FileTypeIcon";
import { useFileViewer } from "./pages/files/viewerContext";
import { host } from "../lib/host";

/** Inline file reference rendered inside a user bubble. The same
 *  component is used whether the user attached via the `+` button
 *  or typed `@<path>` manually. Click → small action menu. */
export function FilePill({ path }: { path: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const viewer = useFileViewer();
  const name = path.split("/").pop() || path;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <span className="file-pill-wrap" ref={wrapRef}>
      <button
        type="button"
        className="file-pill"
        title={path}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
      >
        <span className="file-pill-icon">
          <FileTypeIcon name={name} size={14} />
        </span>
        <span className="file-pill-name">{name}</span>
      </button>
      {menuOpen && (
        <span className="file-pill-menu" role="menu">
          <span className="file-pill-menu-path">{path}</span>
          <button
            type="button"
            className="file-pill-menu-item"
            onClick={() => {
              void copy();
              setMenuOpen(false);
            }}
          >
            {copied ? "Copied!" : "Copy path"}
          </button>
          {viewer ? (
            <>
              {/* The in-app read-only viewer: it reads over the live
                  connection, so it works the same locally and on a
                  cloud VM, where there is no OS editor to open. */}
              <button
                type="button"
                className="file-pill-menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  viewer.open(path);
                }}
              >
                View
              </button>
              {/* The OS editor stays an explicit choice, but only where
                  there is one — the local desktop. */}
              {host.canOpenNatively && (
                <button
                  type="button"
                  className="file-pill-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    void host.openFile(path);
                  }}
                >
                  Open in editor
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="file-pill-menu-item"
              onClick={() => {
                setMenuOpen(false);
                // No in-app viewer wired (a bare render): route through
                // the host bridge — the OS shell on desktop, the preview
                // overlay on web or the cloud, whose paths are the VM's.
                void host.openFile(path);
              }}
            >
              {host.canOpenNatively ? "Open" : "Preview"}
            </button>
          )}
        </span>
      )}
    </span>
  );
}
