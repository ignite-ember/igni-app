/**
 * A link that opens a window on a page: `?open=<page kind>&<param>=…`.
 *
 * Somebody followed a link — an extension's service builds them, for a
 * document it shared, say — and the link names the page and where on it
 * to go. igni reads neither: the page is any page kind (an extension's
 * usually), and every other query parameter igni does not use itself is
 * handed to that page as its launch params, the same params a
 * notification's target carries.
 *
 * A link is an arrival, not a place: the window reads it once, and the
 * address bar then shows where the window is rather than where it came
 * from (`placeSearch`).
 *
 * Where it is, in the address bar, is a page that carries params — the
 * location an extension page reports with `setLocation`, or the params a
 * link opened it with. The extension bridge promises that the host folds
 * that location into its own URL, so a reload or a shared link comes
 * back to the same place; kept only in the window's saved route, a link
 * opened anywhere else showed the chat (R459). A page without params,
 * and the chat, leave nothing there: the same link form, read the same
 * way, so the address is a link to the place.
 */

import type { PageRoute } from "./pageStack";

/** Query parameters igni reads for itself; never a page's. */
const IGNI_PARAMS = new Set([
  "open",
  "dir",
  "ws",
  "demo",
  "debug",
  "expected_cli",
  "actual_cli",
  "backend_source",
]);

export interface Arrival {
  page: string;
  params: Record<string, string>;
}

export const Arrivals = {
  /** The page a window's query string asks for, or `null` for none. */
  fromSearch(search: string): Arrival | null {
    const query = new URLSearchParams(search);
    const page = query.get("open")?.trim() ?? "";
    if (!page) return null;
    const params: Record<string, string> = {};
    for (const [key, value] of query) {
      if (!IGNI_PARAMS.has(key)) params[key] = value;
    }
    return { page, params };
  },

  /** The same query string without the arrival: `open` and its params gone. */
  withoutArrival(search: string): string {
    const query = new URLSearchParams(search);
    if (!query.get("open")) return search;
    const kept = new URLSearchParams();
    for (const [key, value] of query) {
      if (IGNI_PARAMS.has(key) && key !== "open") kept.append(key, value);
    }
    const rest = kept.toString();
    return rest ? `?${rest}` : "";
  },

  /**
   * The query string for the place `page` is: any arrival taken out, and
   * the page put back as `open=<kind>` with its params when it has any.
   * A param named like one of igni's own is not written, since read back
   * it would be igni's, not the page's.
   */
  placeSearch(search: string, page: PageRoute | null): string {
    const query = new URLSearchParams(Arrivals.withoutArrival(search));
    const params = Object.entries(page?.params ?? {}).filter(([key]) => !IGNI_PARAMS.has(key));
    if (page && params.length > 0) {
      query.set("open", page.kind);
      for (const [key, value] of params) query.append(key, value);
    }
    const rest = query.toString();
    return rest ? `?${rest}` : "";
  },
};
