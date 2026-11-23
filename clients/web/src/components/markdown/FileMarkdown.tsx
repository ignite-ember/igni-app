/**
 * A markdown *file* rendered in the read-only viewer.
 *
 * Unlike the chat's {@link ChatMarkdown} — which renders the model's
 * output and keeps raw HTML as text — a file is the person's own, and
 * real READMEs lean on HTML: centred title blocks, ``<details>``,
 * ``<picture>`` with light/dark sources, badges. So this enables raw
 * HTML under the same sanitizer the plugin README uses
 * ({@link README_SANITIZE_SCHEMA}: no scripts, iframes, event handlers
 * or inline styles), and routes fenced blocks by kind the way the chat
 * does, so code gets the copy/collapse treatment and mermaid renders.
 *
 * A link to another file in the project opens that file in the viewer
 * rather than in a browser; only a real outward URL leaves.
 */

import { useMemo, type AnchorHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { MermaidBlock } from "@ignite-ember/ui-react";
import { CodeBlock, MarkdownBlock, PreformattedBlock } from "./CodeBlock";
import { FencedBlock } from "./fencedBlock";
import { README_SANITIZE_SCHEMA } from "./ReadmeMarkdown";

/** A URL that leaves the project — a scheme, protocol-relative, or a
 *  bare in-page anchor, none of which names a project file. */
function isOutward(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

/** Resolve a relative (or root-relative) link against the folder of the
 *  file it sits in, collapsing ``.`` and ``..`` — the project-relative
 *  path of the file it points at. */
export function resolveProjectPath(baseDir: string, href: string): string {
  const clean = href.split("#")[0].split("?")[0];
  const fromRoot = clean.startsWith("/");
  const segments = (fromRoot || !baseDir ? [] : baseDir.split("/")).concat(clean.split("/"));
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** ``components.pre``: render the fence inside by its kind. */
function FilePre({ children }: { children?: ReactNode }) {
  const block = FencedBlock.fromChildren(children);
  if (!block) return <CodeBlock>{children}</CodeBlock>;
  if (block.kind === "mermaid") return <MermaidBlock source={block.source} />;
  if (block.kind === "preformatted") return <PreformattedBlock block={block} />;
  if (block.kind === "markdown") return <MarkdownBlock source={block.source} />;
  return <CodeBlock>{children}</CodeBlock>;
}

export function FileMarkdown({
  text,
  baseDir = "",
  onOpenFile,
}: {
  text: string;
  /** The folder of the file being shown, for resolving relative links. */
  baseDir?: string;
  /** Open another project file in the viewer. */
  onOpenFile?: (path: string) => void;
}) {
  const components = useMemo<Components>(
    () => ({
      pre: FilePre,
      a: ({ node: _node, href, children, ...props }: { node?: unknown } & AnchorHTMLAttributes<HTMLAnchorElement>) => {
        const target = href ?? "";
        // An outward URL opens in a browser; a bare ``#anchor`` is left
        // to the page. Everything else names a file in the project.
        if (!target || target.startsWith("#")) {
          return <a {...props} href={target}>{children}</a>;
        }
        if (isOutward(target)) {
          return <a {...props} href={target} target="_blank" rel="noopener noreferrer">{children}</a>;
        }
        return (
          <a
            {...props}
            href={target}
            onClick={(e) => {
              e.preventDefault();
              onOpenFile?.(resolveProjectPath(baseDir, target));
            }}
          >
            {children}
          </a>
        );
      },
    }),
    [baseDir, onOpenFile],
  );

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, README_SANITIZE_SCHEMA], rehypeHighlight]}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}
