/**
 * A link that opens a window on a page: `?open=<page kind>&<param>=…`.
 *
 * Somebody followed a link — one copied from another window's address
 * bar, or one an extension's service built for a document it shared —
 * and the link names the page and where on it to go. Every other query
 * parameter igni does not use itself is handed to that page as its
 * launch params, the same params a notification's target carries.
 *
 * The address bar is that link for where the window is (`placeSearch`):
 * the page on top, as `open=<kind>`, and its params — the location an
 * extension page reports with `setLocation`, or the params a link opened
 * it with. The extension bridge promises that the host folds the
 * location into its own URL, so a reload, a bookmark or the address
 * copied into another browser comes back to the same page at the same
 * place; kept only in the window's saved route, a link opened anywhere
 * else showed the chat (R459). The chat leaves nothing there. The
 * address is replaced, never pushed: the hosts that load this bundle are
 * webviews as often as browser tabs, and the back button is not the
 * window's way back (see `pageStack.ts`); a `popstate` that does land on
 * an older address is read the same way (`useHostBindings`).
 *
 * Both directions are held to the same rules, because a link is
 * untrusted: the page kind must look like one (`PAGE_KIND`), and only
 * string params within `LOCATION_LIMITS` are kept. Whether the page
 * exists is the registry's question, asked when the route is drawn: a
 * link to a page that is not installed opens the chat (`visible`).
 * Nothing from a link reaches the DOM but as text, or the frame but as
 * the strings of its params.
 *
 * The desktop app's link is the same query behind its own URL scheme:
 * `igni://open?open=<kind>&<params>` (`fromDeepLink`). The shell
 * registers `igni` with the OS, brings its window forward when one is
 * followed, and hands the URL to the window, which reads it here with
 * exactly the rules a web link is read with. The shell only checks the
 * scheme and the length; what the link may open is decided here, once,
 * for both. `deepLinks.cases.json` is the table both sides are tested
 * against.
 */

import { keptLocation, type PageRoute } from "./pageStack";

/** Query parameters igni reads for itself; never a page's. */
const IGNI_PARAMS = new Set([
  "open",
  "dir",
  "ws",
  "host",
  "demo",
  "debug",
  "expected_cli",
  "actual_cli",
  "backend_source",
]);

/** What a page kind looks like: `acme.notes`, `plugins`, `igni.artifacts`. */
const PAGE_KIND = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** The longest query string the address bar is given. Past it the
 *  link names the page without its location: a link that opens the
 *  page beats one some hop truncates into nonsense. */
export const MAX_PLACE_SEARCH = 2048;

/** The desktop app's link: `igni://open`, then the same query a web link
 *  has. The scheme is case-insensitive, as URL schemes are. */
const DEEP_LINK = /^igni:\/\/open\/?(\?[^#]*)?(#.*)?$/i;

export interface Arrival {
  page: string;
  params: Record<string, string>;
}

/** The page's own params of a query, or of a route, within the caps. */
function pageParams(entries: Iterable<[string, string]>): Record<string, string> {
  const own: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!IGNI_PARAMS.has(key) && !Object.hasOwn(own, key)) own[key] = value;
  }
  return keptLocation(own);
}

export const Arrivals = {
  /** The page a window's query string asks for, or `null` for none. */
  fromSearch(search: string): Arrival | null {
    const query = new URLSearchParams(search);
    const page = query.get("open")?.trim() ?? "";
    if (!PAGE_KIND.test(page)) return null;
    return { page, params: pageParams(query) };
  },

  /**
   * The page an `igni://open?…` link asks for, read as `fromSearch` reads
   * a web link's query, or `null` for none: a link that is not igni's, or
   * names no page igni could have, or is longer than any address igni
   * writes (`MAX_PLACE_SEARCH`). A `null` opens the chat.
   */
  fromDeepLink(url: string): Arrival | null {
    const match = DEEP_LINK.exec(url.trim());
    if (!match) return null;
    const search = match[1] ?? "";
    if (search.length > MAX_PLACE_SEARCH) return null;
    return Arrivals.fromSearch(search);
  },

  /** The route an arrival opens: its page alone, named by its kind until
   *  the page's own label is known. */
  route(arrival: Arrival): PageRoute[] {
    return [{ kind: arrival.page, label: arrival.page, params: arrival.params }];
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
   * the page put back as `open=<kind>` with its params. A param named
   * like one of igni's own is not written, since read back it would be
   * igni's, not the page's; a location too long for an address is left
   * out (`MAX_PLACE_SEARCH`), and a kind no link could name writes no
   * page at all.
   */
  placeSearch(search: string, page: PageRoute | null): string {
    const base = new URLSearchParams(Arrivals.withoutArrival(search));
    if (!page || !PAGE_KIND.test(page.kind)) return Arrivals.serialise(base);
    const query = new URLSearchParams(base);
    query.set("open", page.kind);
    const withPage = new URLSearchParams(query);
    for (const [key, value] of Object.entries(pageParams(Object.entries(page.params ?? {})))) {
      query.append(key, value);
    }
    const placed = Arrivals.serialise(query);
    return placed.length <= MAX_PLACE_SEARCH ? placed : Arrivals.serialise(withPage);
  },

  serialise(query: URLSearchParams): string {
    const rest = query.toString();
    return rest ? `?${rest}` : "";
  },
};
