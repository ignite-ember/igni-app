/** A file's size, as a person reads it: "812 B", "12 KB", "1.4 MB". */

/** A file's size in bytes, rounded for a person. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
