/**
 * The files a person's message names, and which of them are the ones
 * they handed over.
 *
 * An upload lands in the session's attachments folder — on the desktop
 * ``<projectDir>/.igni/attachments/<sessionId>/<name>``, in the cloud
 * the reference ``attachment:<id>`` — and is drawn as a block under
 * the message. A file the person only names in their sentence ("look
 * at @src/main.py") stays an inline chip: it is a reference inside
 * the sentence, not a file they sent.
 *
 * The two are told apart by where the file is, never by what it is
 * called: a project file and an upload can share a name.
 */

import { formatFileSize } from "../lib/fileSize";
import { uploadRegistry, type UploadRegistry } from "./uploadRegistry";
import { UserTextTokenizer, type UserTextToken } from "./userTextTokens";

/** Where the window is: the project the chat is about. */
export interface AttachmentPlace {
  /** The project's directory; "" when the window is not locked to one. */
  projectDir: string;
}

/** The cloud's reference for an upload kept in the shared database. */
const CLOUD_UPLOAD = /^attachment:[A-Za-z0-9_-]+$/;

/** The extensions that are drawn as a miniature rather than a row. */
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "apng", "svg", "heic",
]);

/** The file's name — the last segment of its path. */
export function fileNameOf(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

/** The file's extension, lower-cased; "" when it has none. */
export function extensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** One file a message names. */
export class MessageAttachment {
  constructor(
    /** The path (or cloud reference) the message writes. */
    readonly path: string,
    /** The file's name. */
    readonly name: string,
    /** True when the file was uploaded into this project. */
    readonly uploaded: boolean,
    /** The file's size in bytes, when the window knows it. */
    readonly size: number | undefined,
  ) {}

  /** The extension, upper-cased ("PDF"); "" when the name has none. */
  get extension(): string {
    return extensionOf(this.name).toUpperCase();
  }

  /** What a row labels the file by: its extension, or "FILE". */
  get label(): string {
    return this.extension || "FILE";
  }

  /** True when the file is an image, and so can be a miniature. */
  get image(): boolean {
    return IMAGE_EXTENSIONS.has(extensionOf(this.name));
  }

  /** The size as a person reads it; "" when the size is not known. */
  get sizeLabel(): string {
    return this.size === undefined ? "" : formatFileSize(this.size);
  }
}

/**
 * Where a project's uploads live, and whether a path names one.
 *
 * The rule is the location, not the name: an upload is under the
 * project's attachments directory — ``<projectDir>/.igni/attachments/
 * <sessionId>/<name>`` — or the cloud's own reference. Every session's
 * uploads share that one directory, so a message read in another
 * session still shows its uploads as uploads.
 */
export class UploadLocations {
  constructor(private readonly place: AttachmentPlace) {}

  /** The directory every session's uploads of the project live under. */
  get directory(): string[] {
    return [...pathParts(this.place.projectDir), ".igni", "attachments"];
  }

  /** True when `path` names an upload of this project. */
  isUpload(path: string): boolean {
    const ref = path.trim();
    if (!ref) return false;
    if (CLOUD_UPLOAD.test(ref)) return true;
    const project = pathParts(this.place.projectDir);
    const target = isAbsolute(ref) ? pathParts(ref) : [...project, ...pathParts(ref)];
    const directory = [...project, ".igni", "attachments"];
    if (!under(target, directory)) {
      // With no project to resolve against, a path that names the
      // attachments folder of some project is still an upload.
      return project.length === 0 && namesAttachments(target);
    }
    // <session>/<name> under the attachments directory.
    return target.length >= directory.length + 2;
  }
}

/**
 * The files a message names: the uploads it carries, and the
 * references it only mentions.
 */
export class MessageAttachments {
  /** The message's tokens, so the bubble can draw the text around them. */
  readonly tokens: UserTextToken[];
  /** The uploads, in the order the message names them. */
  readonly uploads: MessageAttachment[] = [];
  /** The references, in the order the message names them. */
  readonly references: MessageAttachment[] = [];

  constructor(
    text: string,
    place: AttachmentPlace,
    registry: UploadRegistry = uploadRegistry,
  ) {
    this.tokens = UserTextTokenizer.tokenize(text);
    const locations = new UploadLocations(place);
    const named = new Set<string>();
    for (const token of this.tokens) {
      if (token.kind !== "file" || named.has(token.path)) continue;
      named.add(token.path);
      const attachment = this.attachmentOf(token.path, locations, registry);
      (attachment.uploaded ? this.uploads : this.references).push(attachment);
    }
  }

  /** The file at `path`, as this message names it. */
  private attachmentOf(
    path: string,
    locations: UploadLocations,
    registry: UploadRegistry,
  ): MessageAttachment {
    const facts = registry.of(path);
    return new MessageAttachment(
      path,
      facts?.name || fileNameOf(path),
      locations.isUpload(path),
      facts?.size,
    );
  }

  /** True when the path names an upload — whose chip the bubble drops,
   *  the block under the message drawing it instead. */
  isUpload(path: string): boolean {
    return this.uploads.some((upload) => upload.path === path);
  }
}

/** A path's segments: separators normalised, `.` and `..` folded away. */
function pathParts(path: string): string[] {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/** True when the path is absolute — a Unix root or a Windows drive. */
function isAbsolute(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

/** True when `parts` starts with `prefix`. */
function under(parts: string[], prefix: string[]): boolean {
  return prefix.every((part, index) => parts[index] === part);
}

/** True when the segments name an attachments folder with a file in it. */
function namesAttachments(parts: string[]): boolean {
  for (let i = 0; i + 3 < parts.length; i++) {
    if (parts[i] === ".igni" && parts[i + 1] === "attachments") return true;
  }
  return false;
}
