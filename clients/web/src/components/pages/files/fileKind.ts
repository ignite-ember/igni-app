/**
 * What a file is, decided from its name, so the viewer knows whether to
 * render it as markdown, highlight it as source, or stand back.
 *
 * The read-only viewer reads text (``read_file`` decodes UTF-8 with
 * replacement), so a binary file comes back as mojibake rather than an
 * error. Classifying up front keeps that garbage off the screen and
 * skips the pointless read.
 */

export type FileKind = "markdown" | "text" | "image" | "pdf" | "binary";

const MARKDOWN = new Set(["md", "markdown", "mdx", "mdown", "mkd"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "apng"]);
const BINARY = new Set([
  // archives
  "zip", "gz", "tgz", "tar", "bz2", "xz", "7z", "rar", "jar", "war",
  // compiled / objects
  "exe", "dll", "so", "dylib", "o", "a", "class", "pyc", "wasm", "bin", "dat",
  // media
  "mp3", "wav", "flac", "ogg", "m4a", "aac", "mp4", "mov", "avi", "mkv", "webm",
  // fonts
  "woff", "woff2", "ttf", "otf", "eot",
  // other containers / databases
  "db", "sqlite", "sqlite3",
]);

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
}

/** The kind of file at ``path``. Unknown extensions are treated as text
 *  and read; a text read that turns out binary is caught by
 *  {@link looksBinary}. */
export function classify(path: string): FileKind {
  if (!path) return "text";
  const ext = extensionOf(path);
  if (MARKDOWN.has(ext)) return "markdown";
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (BINARY.has(ext)) return "binary";
  return "text";
}

/** A kind the viewer reads and shows as text or markdown. */
export function isReadable(kind: FileKind): boolean {
  return kind === "text" || kind === "markdown";
}

/** A text read that is really binary — a NUL byte survives the decode,
 *  which no real source file has. */
export function looksBinary(contents: string): boolean {
  return contents.includes("\u0000");
}

/** What to call the kind in the "can't preview" card. */
export function kindLabel(kind: FileKind): string {
  if (kind === "pdf") return "PDF";
  if (kind === "image") return "image";
  return "binary";
}
