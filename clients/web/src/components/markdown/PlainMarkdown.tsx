/**
 * The one ReactMarkdown configuration in the chat: GFM and highlight.js,
 * and no raw-HTML plugin, so HTML in the text stays text.
 */

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark-dimmed.css";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

/** Markdown as written: no repair, and fences render as ``<pre>``
 *  unless ``components`` says otherwise. */
export function PlainMarkdown({ text, components }: { text: string; components?: Components }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}
