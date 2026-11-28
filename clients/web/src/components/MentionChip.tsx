/**
 * A file named inside a person's sentence: a quiet inline chip with the
 * file's glyph and its name, reading as part of the sentence rather
 * than as a button.
 *
 * Hovering or focusing it reveals the path and the two things one can
 * do with a path — copy it, or open the file in the read-only viewer,
 * which is the only way a file opens in igni.
 */

import { useState } from "react";

import { fileNameOf } from "../chat/messageAttachments";
import { FileTypeIcon } from "./FileTypeIcon";
import { useFileViewer } from "./pages/files/viewerContext";

export function MentionChip({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const viewer = useFileViewer();
  const name = fileNameOf(path);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      /* the clipboard is blocked */
    }
  };

  return (
    <span
      className={`mention-chip-wrap${open ? " is-open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button type="button" className="mention-chip">
        <span className="mention-chip-icon">
          <FileTypeIcon name={name} size={13} />
        </span>
        <span className="mention-chip-name">{name}</span>
      </button>
      {open && (
        <span className="mention-chip-panel" role="menu">
          <span className="mention-chip-path">{path}</span>
          <button
            type="button"
            className="mention-chip-action"
            onClick={() => {
              void copy();
            }}
          >
            {copied ? "Copied" : "Copy path"}
          </button>
          {/* The in-app viewer reads over the live connection, so it
              works the same locally and on a cloud VM. */}
          {viewer && (
            <button
              type="button"
              className="mention-chip-action"
              onClick={() => {
                setOpen(false);
                viewer.open(path);
              }}
            >
              Open
            </button>
          )}
        </span>
      )}
    </span>
  );
}
