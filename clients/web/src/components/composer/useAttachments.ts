/**
 * Files from the OS — picked, dropped or pasted — on their way into the
 * draft. Each is shipped to the backend, which writes it under the
 * session's attachments folder and returns the path; the landed path
 * joins the draft as an `@<path>` reference, so the @-mention pipeline
 * resolves it. Until then it shows as a placeholder chip.
 */

import { useRef, useState } from "react";

import type { BackendCalls } from "../../protocol/backendCalls";

/** A file still uploading, shown as a chip. */
export interface PendingUpload {
  key: string;
  name: string;
}

export interface AttachmentsApi {
  uploads: PendingUpload[];
  /** A file is still uploading: a message must wait for it. */
  busy: boolean;
  /** Open the OS file picker. */
  pick: () => void;
  addFiles: (files: File[] | FileList | null) => Promise<void>;
  fileInputProps: React.InputHTMLAttributes<HTMLInputElement> & {
    ref: React.RefObject<HTMLInputElement | null>;
  };
  dropZoneProps: React.HTMLAttributes<HTMLDivElement>;
}

export function useAttachments({
  client,
  onLanded,
}: {
  client: { calls: Pick<BackendCalls, "uploadAttachment"> };
  /** A file reached the project at `path`. */
  onLanded: (path: string) => void;
}): AttachmentsApi {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [dragHot, setDragHot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[] | FileList | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    const pending = list.map((f) => ({
      key: `pending:${f.name}-${Date.now()}-${Math.random()}`,
      name: f.name,
    }));
    setUploads((prev) => [...prev, ...pending]);
    for (const [i, file] of list.entries()) {
      const result = await client.calls.uploadAttachment(file);
      setUploads((prev) => prev.filter((u) => u.key !== pending[i].key));
      if (result.ok) onLanded(result.path);
      else console.warn("Attachment not uploaded:", file.name, result.reason);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return {
    uploads,
    busy: uploads.length > 0,
    pick: () => fileInputRef.current?.click(),
    addFiles,
    fileInputProps: {
      ref: fileInputRef,
      type: "file",
      multiple: true,
      style: { display: "none" },
      onChange: (e) => void addFiles(e.target.files),
    },
    dropZoneProps: {
      className: `composer-zone${dragHot ? " drag-hot" : ""}`,
      onDragOver: (e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!dragHot) setDragHot(true);
        }
      },
      onDragLeave: (e) => {
        // Only when leaving the zone itself, not one of its children.
        if (e.target === e.currentTarget) setDragHot(false);
      },
      onDrop: (e) => {
        if (e.dataTransfer?.files?.length) {
          e.preventDefault();
          setDragHot(false);
          void addFiles(e.dataTransfer.files);
        }
      },
    },
  };
}
