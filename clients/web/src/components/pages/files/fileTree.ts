/**
 * A project's file tree, derived from the flat list of paths the
 * backend already hands us (``complete_files``). No directory-listing
 * RPC exists and none is needed: a set of ``a/b/c.py`` paths names
 * every folder on the way, so one level of the tree is the distinct
 * next segment under a prefix.
 *
 * Pure — the navigator keeps the one search box as its whole state and
 * reads the level to show from here.
 */

/** A row in the navigator: a folder to descend into, or a file to open. */
export interface FileEntry {
  /** The last path segment — what the row shows. */
  name: string;
  /** Project-relative path: the folder's path, or the file's path. */
  path: string;
  kind: "dir" | "file";
}

/** How the search box reads: browse a folder, or find a file anywhere. */
export interface Query {
  /** The folder being browsed (``""`` = project root). */
  dir: string;
  /** What narrows it: a filter within the folder, or the find term. */
  term: string;
  /** ``find`` searches every path; ``browse`` lists one folder. */
  mode: "browse" | "find";
}

/** The folder above this one; ``""`` at the root. */
export function parentDir(dir: string): string {
  const cut = dir.lastIndexOf("/");
  return cut < 0 ? "" : dir.slice(0, cut);
}

/** Case-insensitive, so dotfiles still lead and ``App`` sits by ``api``. */
function byName(a: FileEntry, b: FileEntry): number {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
}

/** Does ``path`` subsequence-match ``term`` (``cfg`` ⊂ ``config``)? */
export function subsequence(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const hay = haystack.toLowerCase();
  const need = needle.toLowerCase();
  let i = 0;
  for (let j = 0; j < hay.length && i < need.length; j++) {
    if (hay[j] === need[i]) i++;
  }
  return i === need.length;
}

/** The immediate children of ``dir`` — folders first, then files. */
export function browse(paths: readonly string[], dir: string): FileEntry[] {
  const prefix = dir ? `${dir}/` : "";
  const dirs = new Set<string>();
  const files: FileEntry[] = [];
  for (const path of paths) {
    if (prefix && !path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash < 0) {
      files.push({ name: rest, path, kind: "file" });
    } else {
      dirs.add(rest.slice(0, slash));
    }
  }
  const rows: FileEntry[] = [];
  for (const name of dirs) rows.push({ name, path: prefix + name, kind: "dir" });
  rows.push(...files);
  return rows.sort(byName);
}

/** Whether ``dir`` is a real folder in the project. */
export function dirExists(paths: readonly string[], dir: string): boolean {
  if (!dir) return true;
  const prefix = `${dir}/`;
  return paths.some((p) => p.startsWith(prefix));
}

/** Files anywhere whose path subsequence-matches ``term``, best first:
 *  a name that starts with the term beats one that merely contains it,
 *  then the shortest path, then alphabetical. Capped. */
export function findFiles(
  paths: readonly string[],
  term: string,
  limit: number,
): { rows: FileEntry[]; capped: boolean } {
  const scored: { entry: FileEntry; rank: number }[] = [];
  const t = term.toLowerCase();
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    let rank: number;
    if (name.toLowerCase().startsWith(t)) rank = 0;
    else if (name.toLowerCase().includes(t)) rank = 1;
    else if (subsequence(path, term)) rank = 2;
    else continue;
    scored.push({ entry: { name, path, kind: "file" }, rank });
  }
  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.entry.path.length !== b.entry.path.length) {
      return a.entry.path.length - b.entry.path.length;
    }
    return a.entry.path < b.entry.path ? -1 : 1;
  });
  return { rows: scored.slice(0, limit).map((s) => s.entry), capped: scored.length > limit };
}

/** Read the search box into a folder-to-browse and a term-to-narrow.
 *  A ``/`` means "a path": everything up to the last one is the folder,
 *  the rest narrows it. No ``/`` with text means "find this anywhere". */
export function readQuery(raw: string): Query {
  const text = raw.replace(/^\/+/, "");
  const slash = text.lastIndexOf("/");
  if (slash < 0) {
    return { dir: "", term: text, mode: text ? "find" : "browse" };
  }
  return { dir: text.slice(0, slash), term: text.slice(slash + 1), mode: "browse" };
}

/** The rows to show for a search box value, and whether the list is cut. */
export function entriesFor(
  paths: readonly string[],
  raw: string,
  limit: number,
): { rows: FileEntry[]; capped: boolean } {
  const q = readQuery(raw);
  if (q.mode === "find") return findFiles(paths, q.term, limit);
  const rows = browse(paths, q.dir).filter((e) => subsequence(e.name, q.term));
  return { rows: rows.slice(0, limit), capped: rows.length > limit };
}
