/**
 * A PDF rendered in the viewer, from its base64 bytes.
 *
 * Through a blob URL, not a ``data:`` one: a data-URL PDF in an iframe is
 * refused by some engines, where a blob is not. The URL is revoked when
 * the bytes change or the frame leaves, so a tab switch does not leak it.
 */

import { useEffect, useState } from "react";

export function PdfFrame({ data }: { data: string }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    try {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } catch {
      setUrl("");
      return undefined;
    }
  }, [data]);

  if (!url) return null;
  return <iframe className="files-pdf" title="PDF preview" src={url} />;
}
