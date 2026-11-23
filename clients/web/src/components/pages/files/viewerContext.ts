/**
 * Opening a file in the read-only viewer from anywhere in the app —
 * a file pill in a chat bubble, a pasted-code pill — without threading a
 * callback through the whole transcript.
 *
 * The window provides it (wired to the page navigator); a consumer that
 * has no provider (a pill rendered in a test, say) gets ``null`` and
 * falls back to the host's own file-open. Backend-agnostic: the viewer
 * reads over the active connection, so the same open works whether igni
 * is running locally or on a cloud VM.
 */

import { createContext, useContext } from "react";

export interface FileViewer {
  /** Open ``path`` (project-relative or absolute) in the Files page. */
  open: (path: string) => void;
}

export const FileViewerContext = createContext<FileViewer | null>(null);

/** The viewer opener, or ``null`` where the window did not provide one. */
export function useFileViewer(): FileViewer | null {
  return useContext(FileViewerContext);
}
