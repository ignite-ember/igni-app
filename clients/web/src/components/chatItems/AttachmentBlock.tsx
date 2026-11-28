/**
 * The files a sent message carries, as a block under it: documents as
 * rows, images as miniatures.
 *
 * A file that cannot be shown as an image — too large, not an image, a
 * read that failed — is drawn as a row instead, so the block always
 * says what the message carried. Only a few miniatures are drawn: the
 * rest are rows, or the block would outgrow the message it belongs to.
 */

import { useCallback, useState } from "react";

import type { MessageAttachment } from "../../chat/messageAttachments";
import { thumbnailCache, type ThumbnailCache } from "../../chat/thumbnailCache";
import type { IgniClient } from "../../protocol/client";
import { AttachmentRow } from "./AttachmentRow";
import { AttachmentThumb } from "./AttachmentThumb";

/** How many miniatures one message may draw. */
export const MAX_THUMBNAILS = 8;

export function AttachmentBlock({
  uploads,
  client,
  cache = thumbnailCache,
}: {
  uploads: MessageAttachment[];
  /** The client the bytes are read over; null where there is none. */
  client: IgniClient | null;
  cache?: ThumbnailCache;
}) {
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const onUnavailable = useCallback((path: string) => {
    setUnavailable((known) => (known.includes(path) ? known : [...known, path]));
  }, []);

  // An image that could not be shown is not a miniature any more; it
  // falls back to a row, and frees its place for the next image.
  const miniatures = uploads
    .filter((upload) => upload.image && !unavailable.includes(upload.path))
    .slice(0, MAX_THUMBNAILS);
  const rows = uploads.filter((upload) => !miniatures.includes(upload));
  if (!uploads.length) return null;

  return (
    <div className="msg-attachments">
      {miniatures.length > 0 && (
        <div className="msg-attachments-thumbs">
          {miniatures.map((upload) => (
            <AttachmentThumb
              key={upload.path}
              attachment={upload}
              client={client}
              cache={cache}
              onUnavailable={onUnavailable}
            />
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="msg-attachments-rows">
          {rows.map((upload) => (
            <AttachmentRow key={upload.path} attachment={upload} />
          ))}
        </div>
      )}
    </div>
  );
}
