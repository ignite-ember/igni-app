/**
 * One uploaded image, as a miniature under the message.
 *
 * The bytes are read only once the message is near the viewport, and
 * only once: the cache keeps what it read, so scrolling back does not
 * read the file again. A file that cannot be shown — too large, not an
 * image, a read that failed — is reported back, and the block draws it
 * as a row instead.
 */

import { useEffect, useState } from "react";

import type { MessageAttachment } from "../../chat/messageAttachments";
import { thumbnailCache, type Thumbnail, type ThumbnailCache } from "../../chat/thumbnailCache";
import type { IgniClient } from "../../protocol/client";
import { FileTypeIcon } from "../FileTypeIcon";
import { useFileViewer } from "../pages/files/viewerContext";
import { useNearViewport } from "./useNearViewport";

export function AttachmentThumb({
  attachment,
  client,
  cache = thumbnailCache,
  onUnavailable,
}: {
  attachment: MessageAttachment;
  /** The client the bytes are read over; null where there is none. */
  client: IgniClient | null;
  cache?: ThumbnailCache;
  /** The file cannot be shown as an image. */
  onUnavailable: (path: string) => void;
}) {
  const viewer = useFileViewer();
  const { ref, near } = useNearViewport<HTMLButtonElement>();
  const [thumbnail, setThumbnail] = useState<Thumbnail | null>(null);

  useEffect(() => {
    if (!near || !client) return;
    let live = true;
    void cache.load(attachment.path, client).then((read) => {
      if (!live) return;
      if (read.url) setThumbnail(read);
      else onUnavailable(attachment.path);
    });
    return () => {
      live = false;
    };
  }, [near, client, cache, attachment.path, onUnavailable]);

  return (
    <button
      type="button"
      ref={ref}
      className="msg-att-thumb"
      title={attachment.name}
      onClick={() => viewer?.open(attachment.path)}
    >
      {thumbnail ? (
        <img className="msg-att-thumb-img" src={thumbnail.url} alt={attachment.name} />
      ) : (
        <span className="msg-att-thumb-glyph">
          <FileTypeIcon name={attachment.name} size={22} />
        </span>
      )}
    </button>
  );
}
