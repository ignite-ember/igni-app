/**
 * What a spec leaves undrawn.
 *
 * A spec that follows the visualizer's prompt names every element it
 * uses: the root points at its children, and every id in a children
 * array is a key of ``elements``. The prompt says so itself — its
 * rule 2 reads "Missing children make whole branches invisible" — but
 * a model that breaks it does not fail loudly. The FE prunes the ids
 * that do not resolve so the Renderer does not crash, and the card
 * comes out empty or half drawn while the agent says the chart is
 * above (R666).
 *
 * Two ways it breaks:
 *
 * - an element points at an id that is not an element: that branch is
 *   invisible;
 * - the elements are all there, but nothing points at them: the
 *   renderer never walks them, so the card draws nothing at all.
 *
 * Both are read from the spec as it arrived — before the pruning, or
 * the evidence is gone — and said in words, so the card can name what
 * it could not draw instead of drawing a blank.
 *
 * The check is on the spec alone: the catalog nests only through
 * ``children`` arrays (no prop holds an element id), so an element
 * that no children array names is one the renderer will never walk.
 */

/** The gaps in a spec. */
export interface SpecIssues {
  /** Child ids an element points at that are not elements of the spec. */
  missing: string[];
  /** Elements nothing points at, so the renderer never walks them. */
  unreachable: string[];
}

/** The elements of a spec, as a map of id to element, or null when the
 *  spec has no element map at all. */
function elementsOf(spec: unknown): Record<string, { type?: unknown; children?: unknown }> | null {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) return null;
  const elements = (spec as { elements?: unknown }).elements;
  if (elements === null || typeof elements !== "object" || Array.isArray(elements)) return null;
  return elements as Record<string, { type?: unknown; children?: unknown }>;
}

/** The ids an element names in its children array. */
function childIds(element: unknown): string[] {
  if (element === null || typeof element !== "object") return [];
  const children = (element as { children?: unknown }).children;
  if (!Array.isArray(children)) return [];
  return children.filter((child): child is string => typeof child === "string");
}

/**
 * The gaps in a spec.
 *
 * A spec whose root is not an element key has no drawing to walk, and
 * the render layer already says that one ("its root is not an element
 * key"), so nothing is added here.
 */
export function specIssues(spec: unknown): SpecIssues {
  const elements = elementsOf(spec);
  if (!elements) return { missing: [], unreachable: [] };
  const root = (spec as { root?: unknown }).root;
  if (typeof root !== "string" || !(root in elements)) return { missing: [], unreachable: [] };

  const missing = new Set<string>();
  const reachable = new Set<string>();
  const queue: string[] = [root];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const child of childIds(elements[id])) {
      if (child in elements) queue.push(child);
      else missing.add(child);
    }
  }
  const unreachable = Object.keys(elements).filter((id) => !reachable.has(id));
  return { missing: [...missing], unreachable };
}

/** ``'chart'`` / ``'chart' and 'table'`` / ``'a', 'b' and 'c'``. */
function listOf(ids: string[]): string {
  const quoted = ids.map((id) => `'${id}'`);
  if (quoted.length === 1) return quoted[0];
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/**
 * The gaps in a spec, as sentences the card can show.
 *
 * Each sentence says what the card could not draw, in the plain words
 * the element guard already uses ("Could not draw BarGraph: its data
 * is not a list").
 */
export function specIssueText(spec: unknown): string[] {
  const { missing, unreachable } = specIssues(spec);
  const out: string[] = [];
  if (missing.length > 0) {
    const one = missing.length === 1;
    out.push(
      `its ${one ? "child" : "children"} ${listOf(missing)} ${one ? "is" : "are"} not ${
        one ? "an element" : "elements"
      } of it`,
    );
  }
  if (unreachable.length > 0) {
    const one = unreachable.length === 1;
    out.push(
      `nothing refers to the ${one ? "element" : "elements"} ${listOf(unreachable)}, so ${
        one ? "it is" : "they are"
      } not drawn`,
    );
  }
  return out;
}
