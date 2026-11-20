/**
 * Extension origins on the desktop's cloud side (design §15.5).
 *
 * `list_extensions` reports each extension's `origin`: where its page is
 * served. In the cloud that is an address inside the VM. Framed on the
 * desktop it would load whatever local server owns that port, and the
 * bridge would talk to it as the extension. So on the cloud the
 * backend's origin is discarded, always, before anything stores it, and
 * replaced by the shell's own loopback origin for that extension
 * (`cloud_page_origin`), which proxies the page from the gateway.
 */

import { host } from "../lib/host";
import type { Side } from "../cloud/backendState";
import type { ExtensionSummary } from "./ExtensionPage";

/** The shell's origin for one extension; rejects when there is none. */
export type PageOriginResolver = (extensionId: string) => Promise<string>;

const fromShell: PageOriginResolver = async (extensionId) => {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke || host.kind !== "tauri") throw new Error("not the desktop app");
  const origin = await invoke("cloud_page_origin", { extensionId });
  if (typeof origin !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    throw new Error("the shell gave no loopback origin");
  }
  return origin;
};

/** The list with every origin cleared: what may be stored on the cloud
 *  side before the shell has answered. */
export function withoutOrigins(listed: readonly ExtensionSummary[]): ExtensionSummary[] {
  return listed.map((e) => (e.origin ? { ...e, origin: "" } : e));
}

/**
 * The list as this window may frame it. Locally, as it is. On the
 * cloud, each non-empty origin replaced by the shell's for that
 * extension; a failed ask gives `""`, which the page shows as "its UI is
 * not being served".
 */
export async function localiseOrigins(
  listed: readonly ExtensionSummary[],
  side: Side,
  resolve: PageOriginResolver = fromShell,
): Promise<ExtensionSummary[]> {
  if (side !== "cloud") return [...listed];
  return Promise.all(
    listed.map(async (e) => {
      if (!e.origin) return e;
      try {
        return { ...e, origin: await resolve(e.id) };
      } catch {
        return { ...e, origin: "" };
      }
    }),
  );
}
