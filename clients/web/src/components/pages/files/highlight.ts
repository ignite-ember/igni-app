/**
 * Syntax highlighting for the read-only viewer, as one highlighted
 * fragment per source line.
 *
 * highlight.js is already in the bundle (the markdown renderer uses it)
 * and ``theme.css`` already paints its ``.hljs-*`` token classes in both
 * themes, so the viewer gets the same colours the chat's code blocks do
 * for free — it only has to produce the spans.
 *
 * The one real problem is the gutter: line numbers want one DOM row per
 * line, but a highlighted span (a block comment, a multi-line string)
 * can straddle newlines, and splitting its HTML on ``\n`` would leave a
 * ``<span>`` open at the end of one line and orphan a ``</span>`` on the
 * next. {@link splitHighlightedLines} splits at newlines while closing
 * every open span at the break and reopening it after, so each line is
 * self-contained.
 */

import hljs from "highlight.js/lib/common";

/** Backend/Prism language names that differ from highlight.js's, plus
 *  the extensions the backend may not have resolved. Anything not here
 *  is tried as-is, then auto-detected. */
const LANGUAGE_ALIAS: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  mdx: "markdown",
  html: "xml",
  htm: "xml",
  vue: "xml",
  cs: "csharp",
  "c++": "cpp",
  cc: "cpp",
  h: "cpp",
  hpp: "cpp",
  kt: "kotlin",
  rs: "rust",
  text: "plaintext",
  txt: "plaintext",
};

/** The highlight.js language id to use, or ``""`` to auto-detect. The
 *  backend's guess wins when highlight.js knows it; otherwise the file
 *  extension decides. */
export function resolveLanguage(path: string, backendLang?: string): string {
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  for (const candidate of [backendLang, LANGUAGE_ALIAS[backendLang ?? ""], ext, LANGUAGE_ALIAS[ext]]) {
    if (candidate && hljs.getLanguage(candidate)) return candidate;
  }
  return "";
}

/** The highlighted HTML for a whole file; auto-detects when the
 *  language is unknown. Never throws — an illegal token falls back to
 *  escaped, unhighlighted text. */
function highlightAll(code: string, language: string): string {
  try {
    if (language) return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ESCAPES[c]);
}

/**
 * Split highlighted HTML into one self-contained fragment per line,
 * carrying open spans across each newline.
 *
 * highlight.js output is only escaped text interleaved with
 * ``<span class="…">`` opens and ``</span>`` closes, so a tag-or-text
 * tokenizer is enough. Newlines only ever occur in text runs (never
 * inside a tag), which is what makes the carry safe.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const openStack: string[] = [];
  let current = "";

  const closeOpen = () => openStack.map(() => "</span>").join("");
  const reopen = () => openStack.join("");

  const tokens = html.match(/<[^>]+>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token[0] === "<") {
      if (token.startsWith("</")) openStack.pop();
      else if (!token.endsWith("/>")) openStack.push(token);
      current += token;
      continue;
    }
    // A text run: break it at every newline, closing and reopening the
    // span stack around each break so no line leaves a span dangling.
    const parts = token.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push(current + closeOpen());
        current = reopen();
      }
      current += parts[i];
    }
  }
  lines.push(current);

  // A file that ends in a newline yields a trailing empty element; drop
  // it so the gutter does not show a phantom last line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** One highlighted HTML fragment per line of ``code``. */
export function highlightToLines(code: string, language: string): string[] {
  return splitHighlightedLines(highlightAll(code, language));
}
