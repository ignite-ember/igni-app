/**
 * A plugin README: third-party markup rendered inside the app's own
 * window, so it is the one ReactMarkdown here with raw HTML enabled, and
 * the sanitizer below is what makes that safe.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/**
 * The README sanitize policy: the rehype-sanitize default (no `<script>`,
 * `<iframe>`, event handlers or `javascript:` URLs), widened only for the
 * layouts real READMEs use: centred title blocks (`align`), `<picture>`
 * with light/dark sources (`srcSet`, `media`), sized badges (`width`,
 * `height`), `<details>`, and a few inline tags.
 *
 * Two attributes are left out on purpose:
 *  - `style`, anywhere. It would let a listing paint a full-window overlay
 *    that passes for the app's own dialog, and `url(...)` in it makes an
 *    outbound request on render, which self-hosting.md section 8 rules out.
 *  - `rel` on `<a>`. The app sets it (see {@link README_COMPONENTS}), so a
 *    README cannot ask for `opener` and re-enable reverse tabnabbing.
 *
 * Remote `<img>` src stays allowed, and is an outbound request: badges are
 * the most common thing in a README, and blocking them breaks every
 * listing. It leaks only that a listing was viewed.
 */
export const README_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "picture",
    "source",
    "video",
    "audio",
    "track",
    "details",
    "summary",
    "kbd",
    "sub",
    "sup",
    "mark",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] || []), "align"],
    img: [...(defaultSchema.attributes?.img || []), "align", "width", "height", "loading"],
    // rehype-sanitize matches hast property names, which are camelCase:
    // `srcSet` is the one that takes effect. `srcset` is listed beside it
    // so a reader does not "fix" the spelling.
    source: ["srcSet", "srcset", "media", "type"],
    a: [...(defaultSchema.attributes?.a || []), "target"],
  },
};

/** Anchors in a README point outward, so they open in a new context with
 *  a `rel` the app sets rather than one the README supplies. */
export const README_COMPONENTS = {
  a: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

/** A README rendered under {@link README_SANITIZE_SCHEMA}. */
export function ReadmeMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, README_SANITIZE_SCHEMA], rehypeHighlight]}
      components={README_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
}
