/**
 * The one ReactMarkdown configuration in the chat: GFM and highlight.js,
 * and no raw-HTML plugin, so HTML in the text stays text.
 */

import type { AnchorHTMLAttributes } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github-dark-dimmed.css";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

/** A link that leaves igni: the web, mail or a phone number. */
const OUTWARD = /^(https?:|mailto:|tel:)/i;

/**
 * Links in a reply are the model's, so they are treated as untrusted. One
 * that leaves igni opens in a new browsing context with no handle back on
 * the app (`noopener`, and `noreferrer` so the app's address — which can
 * carry `?ws=` — is not sent). Before this, a click on any link in a reply
 * navigated the web client's own tab away, losing the conversation on
 * screen. The desktop shell intercepts the same click first and hands it
 * to the system browser (`init_script.js`), so this changes nothing there.
 * react-markdown's own URL filter has already dropped `javascript:` and
 * friends by the time an `href` gets here.
 */
function ReplyLink({ node: _node, href, ...props }: { node?: unknown } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href && OUTWARD.test(href)) {
    return <a {...props} href={href} target="_blank" rel="noopener noreferrer" />;
  }
  return <a {...props} href={href} />;
}

const DEFAULT_COMPONENTS: Components = { a: ReplyLink };

/** Markdown as written: no repair, and fences render as ``<pre>``
 *  unless ``components`` says otherwise. */
export function PlainMarkdown({ text, components }: { text: string; components?: Components }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={components ? { ...DEFAULT_COMPONENTS, ...components } : DEFAULT_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
}
