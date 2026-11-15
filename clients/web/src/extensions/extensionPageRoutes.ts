/**
 * What an extension page's own requests do to the window's route.
 *
 * A page asks the host to go to another page with `navigate(to)`. The
 * frame delivered the message and nothing answered it: the host mounted
 * the page without the callback, so it was dropped (R405). This is the
 * answer, pure so the rule is read in one place.
 *
 * The route (`ui.route`) is the window's address, persisted per window
 * and restored on reload.
 */

import { BASE_PAGE_KINDS, type PageRoute } from "../chat/pageStack";
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
