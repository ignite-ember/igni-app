/**
 * Heading anchors for a markdown file, the way GitHub makes them, so a
 * ``#a-heading`` link — in the same file or from another — has
 * something to land on.
 *
 * The sanitizer prefixes every ``id`` it keeps with
 * ``user-content-`` (so a document cannot shadow the app's own ids);
 * {@link anchorElementId} names the element a fragment lands on after it.
 */

/** The parts of a hast node the slugger reads. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const HEADING = /^h[1-6]$/;

/** The prefix the sanitizer puts on every id it keeps. */
export const CLOBBER_PREFIX = "user-content-";

/** A node's text, as GitHub reads a heading for its slug. */
function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** GitHub's slug: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** A rehype plugin: every heading without an id gets its slug, the
 *  second of a name ``-1``, the third ``-2``, as on GitHub. */
export function rehypeHeadingSlugs() {
  return (tree: HastNode) => {
    const seen = new Map<string, number>();
    const visit = (node: HastNode) => {
      if (node.type === "element" && node.tagName && HEADING.test(node.tagName)) {
        const props = (node.properties ??= {});
        if (!props.id) {
          const base = slugify(textOf(node));
          const n = seen.get(base) ?? 0;
          seen.set(base, n + 1);
          props.id = n === 0 ? base : `${base}-${n}`;
        }
      }
      (node.children ?? []).forEach(visit);
    };
    visit(tree);
  };
}

/** The id of the element a ``#fragment`` lands on, once sanitized. */
export function anchorElementId(fragment: string): string {
  let name = fragment.replace(/^#/, "");
  try {
    name = decodeURIComponent(name);
  } catch {
    // A malformed escape is looked up as written.
  }
  return CLOBBER_PREFIX + name;
}

/** Scroll ``root``'s element for ``fragment`` into view; false when the
 *  document has no such anchor. */
export function scrollToAnchor(root: ParentNode | null | undefined, fragment: string): boolean {
  if (!root || !fragment.replace(/^#/, "")) return false;
  const id = anchorElementId(fragment);
  const target = Array.from(root.querySelectorAll<HTMLElement>("[id]")).find((el) => el.id === id);
  if (!target) return false;
  target.scrollIntoView({ block: "start" });
  return true;
}
