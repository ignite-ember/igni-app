/**
 * One uploaded file, as a row under the message: its type glyph, the
 * extension it is labelled by, its name and its size when the window
 * knows it. Clicking opens it in the read-only viewer.
 */

import type { MessageAttachment } from "../../chat/messageAttachments";
import { FileTypeIcon } from "../FileTypeIcon";
import { useFileViewer } from "../pages/files/viewerContext";

export function AttachmentRow({ attachment }: { attachment: MessageAttachment }) {
  const viewer = useFileViewer();
  return (
    <button
      type="button"
      className="msg-att-row"
      title={attachment.path}
      aria-label={attachment.name}
      onClick={() => viewer?.open(attachment.path)}
    >
      <span className="msg-att-glyph">
        <FileTypeIcon name={attachment.name} size={15} />
      </span>
      <span className="msg-att-label">{attachment.label}</span>
      <span className="msg-att-name">{attachment.name}</span>
      {attachment.sizeLabel && <span className="msg-att-size">{attachment.sizeLabel}</span>}
    </button>
  );
}
