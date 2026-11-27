/**
 * The read-only viewer's body. What it shows depends on the file: a
 * markdown file renders as markdown (it is read-only, so the formatted
 * form is the useful one), a text or code file is highlighted source
 * with a line-number gutter, and anything the text read cannot show — a
 * PDF, an image, a binary — stands back with a way to open it elsewhere.
 */

import { useLayoutEffect, useMemo, useRef } from "react";

import { FileIcon } from "../../Icons";
import { FileMarkdown } from "../../markdown/FileMarkdown";
import { scrollToAnchor } from "../../markdown/headingSlugs";
import { classify, kindLabel, looksBinary } from "./fileKind";
import { parentDir } from "./fileTree";
import { PdfFrame } from "./PdfFrame";
import type { FileBytes } from "./useFileBytes";
import { highlightToLines, resolveLanguage } from "./highlight";
import type { FileContents } from "./useFileContents";

export function FileViewer({
  path,
  file,
  loading,
  error,
  wordWrap,
  tabSize,
  renderMarkdown,
  empty,
  scrollMemory,
  onOpenExternally,
  onOpenFile,
  bytes,
  bytesLoading,
  bytesError,
}: {
  /** The active file's path — always the real one, even for a binary
   *  file the text read is skipped for. */
  path: string;
  file: FileContents;
  loading: boolean;
  error: string;
  /** The raw bytes, for an image or PDF; empty otherwise. */
  bytes: FileBytes;
  bytesLoading: boolean;
  bytesError: string;
  wordWrap: boolean;
  tabSize: number;
  /** Render a markdown file rather than show its source. */
  renderMarkdown: boolean;
  /** Shown when no file is open — the viewer's resting state. */
  empty: string;
  /** Per-file scroll offset, owned above the viewer so it survives the
   *  dock closing and the viewer unmounting with it. */
  scrollMemory: Map<string, number>;
  /** Open the file in the OS app, when there is one (desktop only). */
  onOpenExternally?: () => void;
  /** Open another project file — a markdown link to one lands here. */
  onOpenFile?: (path: string) => void;
}) {
  const kind = classify(path);
  const nulBinary = (kind === "text" || kind === "markdown") && looksBinary(file.contents);
  const isImage = kind === "image";
  const isPdf = kind === "pdf";
  // Other binary — or a text file the decode found NUL in — has nothing
  // to render, so it gets the "open it elsewhere" card.
  const asCard = kind === "binary" || nulBinary;
  const asMarkdown = kind === "markdown" && renderMarkdown && !nulBinary;
  const ready = file.path === path && !!file.contents;

  const lines = useMemo(
    () =>
      ready && !asMarkdown && !isImage && !isPdf && !asCard
        ? highlightToLines(file.contents, resolveLanguage(path, file.language))
        : [],
    [ready, file.contents, path, file.language, asMarkdown, isImage, isPdf, asCard],
  );

  // One scroll box is reused as the person switches tabs, so each file
  // carries its own offset: save the showing file's as it scrolls, and
  // restore the next file's when it renders. Refs, no render.
  const scrollRef = useRef<HTMLDivElement>(null);
  const showing = useRef<string>("");
  const remember = () => {
    const el = scrollRef.current;
    if (el && showing.current) scrollMemory.set(showing.current, el.scrollTop);
  };
  // A link to ``other.md#heading`` lands on the heading once that file
  // renders, instead of where it was last left.
  const pendingAnchor = useRef<{ path: string; anchor: string } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !path) return;
    showing.current = path;
    const pending = pendingAnchor.current;
    if (pending?.path === path && ready) {
      pendingAnchor.current = null;
      if (scrollToAnchor(el, pending.anchor)) return;
    }
    el.scrollTop = scrollMemory.get(path) ?? 0;
  }, [path, ready, file.contents, bytes.data, asMarkdown, isImage, asCard, scrollMemory]);
  const openFile = (target: string, anchor?: string) => {
    if (target === path && anchor) {
      scrollToAnchor(scrollRef.current, anchor);
      return;
    }
    pendingAnchor.current = anchor ? { path: target, anchor } : null;
    onOpenFile?.(target);
  };

  if (!path) return <div className="files-code-state files-code-empty">{empty}</div>;

  if (isImage || isPdf) {
    if (bytesError) return <div className="files-code-state msg-error">{bytesError}</div>;
    if (bytesLoading && !bytes.data) return <div className="files-code-state msg-info">Loading…</div>;
    if (bytes.data && isImage) {
      return (
        <div className="files-image" ref={scrollRef} onScroll={remember}>
          <img className="files-image-el" src={`data:${bytes.mediaType};base64,${bytes.data}`} alt={path} />
        </div>
      );
    }
    if (bytes.data && isPdf) return <PdfFrame data={bytes.data} />;
    return <div className="files-code-state msg-info">Loading…</div>;
  }

  if (asCard) {
    const label = nulBinary ? "binary" : kindLabel(kind);
    return (
      <div className="files-code-state files-unsupported">
        <span className="files-unsupported-icon" aria-hidden="true">
          <FileIcon size={30} />
        </span>
        <p className="files-unsupported-title">
          This is {label === "image" ? "an" : "a"} {label} file.
        </p>
        <p className="files-unsupported-note">
          The viewer reads text, so it can’t show it here.
          {onOpenExternally ? " Open it in your default app instead." : ""}
        </p>
        {onOpenExternally && (
          <button type="button" className="files-unsupported-open" onClick={onOpenExternally}>
            Open externally
          </button>
        )}
      </div>
    );
  }

  if (error) return <div className="files-code-state msg-error">{error}</div>;
  if (loading && file.path !== path) return <div className="files-code-state msg-info">Loading…</div>;

  if (asMarkdown) {
    return (
      <div className="files-md" ref={scrollRef} onScroll={remember}>
        <div className="files-md-body">
          <FileMarkdown text={file.contents} baseDir={parentDir(path)} onOpenFile={openFile} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="files-code"
      ref={scrollRef}
      onScroll={remember}
      data-wrap={wordWrap ? "on" : "off"}
      style={{ tabSize, MozTabSize: tabSize } as React.CSSProperties}
    >
      {lines.map((html, i) => (
        // eslint-disable-next-line react/no-array-index-key -- lines are positional and never reordered
        <div className="files-line" key={i}>
          <span className="files-line-no" aria-hidden="true">
            {i + 1}
          </span>
          {/* highlight.js escapes the file's text, so the only markup
              here is its own ``.hljs-*`` token spans — never content. */}
          <code
            className="files-line-src hljs"
            // eslint-disable-next-line react/no-danger -- highlight.js output, escaped at the source
            dangerouslySetInnerHTML={{ __html: html || "​" }}
          />
        </div>
      ))}
    </div>
  );
}
