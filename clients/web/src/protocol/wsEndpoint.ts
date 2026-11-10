/**
 * Where the backend's WebSocket is, and how to prove we may use it.
 *
 * The WS URL is provided by the embedding shell (Tauri) via the `?ws=`
 * query param; `ws://127.0.0.1:8765` is the dev-server fallback.
 *
 * The backend's WebSocket is open to every web page and local process
 * unless it checks who connects, so a backend the desktop shell spawned
 * requires the shell's per-launch token. The shell puts it in the URL
 * fragment (`#igni_ws_token=…`, never sent to a server, kept across
 * reloads); an embedder can also use `<meta name="igni-ws-token">` or
 * `window.__IGNI_WS_TOKEN__`. It goes to the backend as the WebSocket
 * subprotocol `igni-token.<token>` next to `igni.v1` — the one handshake
 * field a browser lets a page set, and unlike the query string it ends
 * up in no request log. See `src/igni_core/transport/ws_auth.py`.
 */

declare global {
  interface Window {
    /** The backend's per-launch WebSocket token, for an embedder that
     *  injects globals rather than navigating with a fragment. */
    __IGNI_WS_TOKEN__?: string;
  }
}

export function resolveWsUrl(): string {
  const param = new URLSearchParams(window.location.search).get("ws");
  const url = param || "ws://127.0.0.1:8765";
  // Confirms which URL ended up on the wire. Logged once at
  // construction time.
  // eslint-disable-next-line no-console
  console.info("[igni] WS URL:", url, "(param:", param, ")");
  return url;
}

/** The subprotocol igni's backend speaks (and selects). */
export const WS_SUBPROTOCOL = "igni.v1";
/** The offered subprotocol that carries the token. */
export const WS_TOKEN_PROTOCOL_PREFIX = "igni-token.";
const WS_TOKEN_FRAGMENT_KEY = "igni_ws_token";

/** The backend's per-launch token, or "" when this backend needs none
 *  (one started by hand or by an IDE plugin). Never logged. */
export function resolveWsToken(): string {
  const hash = (typeof window !== "undefined" && window.location?.hash) || "";
  const fromFragment = new URLSearchParams(hash.replace(/^#/, "")).get(WS_TOKEN_FRAGMENT_KEY);
  const metaTag =
    typeof document !== "undefined"
      ? (document.querySelector('meta[name="igni-ws-token"]') as HTMLMetaElement | null)
      : null;
  return (
    fromFragment ||
    metaTag?.content ||
    (typeof window !== "undefined" ? window.__IGNI_WS_TOKEN__ : "") ||
    ""
  ).trim();
}

/** What to offer as `Sec-WebSocket-Protocol`. Nothing without a token,
 *  so a client still reaches a backend that predates the check. */
export function wsProtocols(token: string): string[] | undefined {
  return token ? [WS_SUBPROTOCOL, `${WS_TOKEN_PROTOCOL_PREFIX}${token}`] : undefined;
}
