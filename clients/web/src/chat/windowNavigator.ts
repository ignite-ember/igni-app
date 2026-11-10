/**
 * Where this window is: every move is a write of ``ui.route``, which an
 * extension's ``navigate`` writes too.
 *
 * The methods are arrow-bound, so each keeps its identity for the
 * window's life: ``ShellPort.goPage`` is one of them.
 */

import type { WindowModel } from "../clientState";
import { current, openRoot, pop, truncateTo, visible, type PageRoute } from "./pageStack";

export class WindowNavigator {
  constructor(private readonly windowModel: Pick<WindowModel, "write">) {}

  navigate = (route: PageRoute[]): void => {
    this.windowModel.write("route", route);
  };

  /** "Take me to X" means the top of X, even when X already shows one
   *  of its own sub-views. */
  openPage = (to: PageRoute): void => this.navigate(openRoot(to));

  /** Back to the chat. */
  closePages = (): void => this.navigate([]);

  /** One level up the trail; at its root, the chat. */
  back = (trail: readonly PageRoute[]): void => this.navigate(pop(trail));

  /** A breadcrumb: everything above it goes. */
  toCrumb = (trail: readonly PageRoute[], index: number): void =>
    this.navigate(truncateTo(trail, index));
}

export interface VisiblePages {
  /** The part of the route this window can draw. */
  pages: PageRoute[];
  /** The page on top, or ``null`` while the chat shows. */
  page: PageRoute | null;
}

/** An extension's page appears once its extension is listed. Computed
 *  every render, because the page registry fills in place as extensions
 *  install. */
export function useVisiblePages(
  route: readonly PageRoute[],
  registry: { has(kind: string): boolean },
): VisiblePages {
  const pages = visible(route, registry);
  return { pages, page: current(pages) };
}
