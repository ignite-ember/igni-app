/**
 * What an extension page's own requests do to the window's route.
 *
 * A page asks for two things through the bridge: `navigate(to)`, to go to
 * another page, and `setLocation(state)`, to say where inside itself the
 * person now is. The frame delivered both, and nothing answered either:
 * the host mounted the page without the callbacks, so the messages were
 * dropped (R405, R410). These are the answers, pure so the rules are read
 * in one place.
 *
 * The route (`ui.route`) is the window's address. It is persisted per
 * window and restored on reload, and the top page's `params` are what the
 * frame is greeted with, so a location folded in there is replayed in the
 * next `hello`.
 */

import { BASE_PAGE_KINDS, keptLocation, type PageRoute } from "../chat/pageStack";

// The caps live with the route, since a followed link is held to them too.
export { LOCATION_LIMITS, keptLocation } from "../chat/pageStack";
import { PAGE_FOR_ACTION } from "../chat/slashCommandRouter";
import type { ExtensionSummary } from "./ExtensionPage";

/** The breadcrumb label for a page kind: igni's own name for its pages,
 *  an extension's label for its own, or the kind itself. */
export function pageLabel(kind: string, extensions: readonly ExtensionSummary[]): string {
  for (const entry of Object.values(PAGE_FOR_ACTION)) {
    if (entry?.route.kind === kind) return entry.route.label;
  }
  for (const extension of extensions) {
    const page = extension.pages.find((p) => p.kind === kind);
    if (page) return page.label;
  }
  return kind;
}

/**
 * The route `navigate(to)` asks for, or `null` when the host declines:
 * the bridge leaves the decision to the host, and a page that is not
 * there right now is not one to go to.
 */
export function routeForNavigate(
  to: string,
  known: { has(kind: string): boolean },
  extensions: readonly ExtensionSummary[],
): PageRoute[] | null {
  if (typeof to !== "string" || !to) return null;
  const isPage = known.has(to) || (BASE_PAGE_KINDS as readonly string[]).includes(to);
  if (!isPage) return null;
  return [{ kind: to, label: pageLabel(to, extensions) }];
}

/**
 * The route with the top page's location replaced by `state`. The trail
 * below it is untouched; with no page on top there is nowhere to fold it.
 */
export function routeWithLocation(
  trail: readonly PageRoute[],
  state: Record<string, unknown>,
): PageRoute[] | null {
  if (trail.length === 0) return null;
  const top = trail[trail.length - 1];
  return [...trail.slice(0, -1), { ...top, params: keptLocation(state) }];
}
