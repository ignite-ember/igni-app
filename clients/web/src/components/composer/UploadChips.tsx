import type { PendingUpload } from "./useAttachments";

/** Uploads in flight show as chips until the backend returns a path,
 *  which then joins the draft as a pill. */
export function UploadChips({ uploads }: { uploads: PendingUpload[] }) {
  if (!uploads.length) return null;
  return (
    <div className="composer-attachments">
      {uploads.map((u) => (
        <span key={u.key} className="composer-chip-attach uploading" title={`${u.name} (uploading…)`}>
          <span className="composer-chip-name">{u.name}</span>
        </span>
      ))}
    </div>
  );
}
