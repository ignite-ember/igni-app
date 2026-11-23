/**
 * The file navigator: one search box that is both a folder browser and
 * a project-wide find. Empty, it lists the root; type a path with a
 * ``/`` and it walks into that folder; type a bare word and it finds
 * matching files anywhere. Folders descend, files open. Driven entirely
 * by the box's value — the page owns that so the ⋯ menu can focus it.
 */

import { useMemo, type RefObject } from "react";

import { CodeBracketIcon, FileIcon, FolderIcon, LevelUpIcon, SearchIcon, XIcon } from "../../Icons";
import { entriesFor, parentDir, readQuery, type FileEntry } from "./fileTree";

/** How many rows to show before asking the person to narrow. */
const ROW_LIMIT = 300;

const CODE_LIKE = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp",
  "cs", "php", "swift", "sh", "bash", "zsh", "sql", "css", "scss", "less", "html", "xml", "vue", "svelte",
  "json", "yaml", "yml", "toml", "ini", "cfg", "md", "mdx", "txt", "env", "lock", "makefile", "dockerfile",
]);

function fileGlyph(name: string) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : name.toLowerCase();
  return CODE_LIKE.has(ext) ? <CodeBracketIcon /> : <FileIcon size={13} />;
}

export function FileNavigator({
  paths,
  total,
  loading,
  error,
  value,
  onChange,
  onOpenFile,
  activePath,
  inputRef,
}: {
  paths: string[];
  total: number;
  loading: boolean;
  error: string;
  value: string;
  onChange: (next: string) => void;
  onOpenFile: (path: string) => void;
  /** The file currently in the viewer, to mark its row. */
  activePath: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const dir = readQuery(value).dir;
  const { rows, capped } = useMemo(() => entriesFor(paths, value, ROW_LIMIT), [paths, value]);
  const cut = capped || total > paths.length;

  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "dir") onChange(`${entry.path}/`);
    else onOpenFile(entry.path);
  };

  const goUp = () => {
    const parent = parentDir(dir);
    onChange(parent ? `${parent}/` : "");
  };

  return (
    <div className="files-nav">
      <div className="files-search">
        <SearchIcon size={14} />
        <input
          ref={inputRef}
          className="files-search-input"
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder="Search files…"
          aria-label="Search files"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && rows.length) openEntry(rows[0]);
          }}
        />
        {value && (
          <button
            className="files-search-clear kb-icon-btn"
            title="Clear"
            aria-label="Clear search"
            onClick={() => onChange("")}
          >
            <XIcon size={11} />
          </button>
        )}
      </div>

      <div className="files-nav-list" role="listbox" aria-label="Project files">
        {dir && (
          <button className="files-row files-row--up" onClick={goUp}>
            <LevelUpIcon size={14} />
            <span className="files-row-name">Go up to project files</span>
          </button>
        )}

        {error ? (
          <div className="files-nav-state msg-error">{error}</div>
        ) : loading && paths.length === 0 ? (
          <div className="files-nav-state msg-info">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="files-nav-state files-nav-empty">No files match.</div>
        ) : (
          rows.map((entry) => (
            <button
              key={`${entry.kind}:${entry.path}`}
              className={`files-row files-row--${entry.kind}${entry.path === activePath ? " is-active" : ""}`}
              onClick={() => openEntry(entry)}
              title={entry.path}
            >
              <span className="files-row-icon">
                {entry.kind === "dir" ? <FolderIcon size={14} /> : fileGlyph(entry.name)}
              </span>
              <span className="files-row-name">{entry.name}</span>
            </button>
          ))
        )}

        {cut && <p className="files-nav-note">Some entries may not be listed. Keep typing to narrow.</p>}
      </div>
    </div>
  );
}
