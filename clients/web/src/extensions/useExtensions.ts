/**
 * What is installed, and the app's navigation with it folded in.
 *
 * The {@link Contributions} registry is this window's, made once per
 * mount — not module scope, so two mounts (StrictMode, a test) never
 * share one. The list is held in state as well, because the nav needs
 * only the labels and an extension's page needs the rest: the origin to
 * frame, the grants, its state and why.
 *
 * On the desktop's cloud side every list is localised before it is
 * stored (`cloudPageOrigins.ts`): the backend's origin is a VM-internal
 * address, so it is cleared at once and replaced by the shell's own
 * origin for that extension. That holds for the list fetched on connect
 * and for every `setExtensions` the settings panel makes; no path stores
 * the backend's origin.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { PageRegistry } from "../chat/pageStack";
import type { WindowModel } from "../clientState";
import type { IgniClient } from "../protocol/client";
import { ListExtensionsResult } from "../protocol/rpcResults";
import { windowSide, type Side } from "../cloud/backendState";
import { BASE_SIDEBAR_LINKS, BASE_TOOLS_MENU } from "./baseNavigation";
import { localiseOrigins, withoutOrigins, type PageOriginResolver } from "./cloudPageOrigins";
import { Contributions } from "./contributions";
import type { ExtensionSummary } from "./ExtensionPage";

export interface Extensions {
  contributions: Contributions;
  extensions: ExtensionSummary[];
  setExtensions: Dispatch<SetStateAction<ExtensionSummary[]>>;
  /** Names to label an extension's chat messages with — they carry its id. */
  extensionNames: Map<string, string>;
}

export function useExtensions(
  client: Pick<IgniClient, "rpc">,
  connected: boolean,
  windowModel: Pick<WindowModel, "get" | "write">,
  side: Side = windowSide(),
  resolveOrigin?: PageOriginResolver,
): Extensions {
  const contributions = useMemo(
    () => new Contributions(BASE_SIDEBAR_LINKS, BASE_TOOLS_MENU, new PageRegistry()),
    [],
  );
  const [extensions, store] = useState<ExtensionSummary[]>([]);
  const latest = useRef<ExtensionSummary[]>([]);
  const generation = useRef(0);
  const setExtensions = useCallback<Dispatch<SetStateAction<ExtensionSummary[]>>>(
    (next) => {
      const value = typeof next === "function" ? next(latest.current) : next;
      const mine = ++generation.current;
      const keep = (list: ExtensionSummary[]) => {
        latest.current = list;
        store(list);
      };
      if (side !== "cloud") {
        keep(value);
        return;
      }
      keep(withoutOrigins(value));
      void localiseOrigins(value, side, resolveOrigin).then((localised) => {
        if (mine === generation.current) keep(localised);
      });
    },
    [side, resolveOrigin],
  );
  const extensionNames = useMemo(
    () => new Map(extensions.map((e) => [e.id, e.name])),
    [extensions],
  );

  // On connect rather than once: extensions live in the backend, and a
  // reconnect may find one installed or removed. The clean-up takes
  // back what this run folded in, or a reconnect would fold every page
  // in again and each would be refused as colliding with itself.
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const owners: string[] = [];
    void listExtensions(client, () => alive)
      .then((raw) => {
        if (!alive) return;
        const listed = ListExtensionsResult.parse(raw).extensions;
        setExtensions(listed);
        for (const extension of listed) {
          // A FAILED extension keeps its sidebar entry: the page it
          // opens says what went wrong, which is what an administrator
          // is looking for.
          const refusals = contributions.install(extension.id, {
            pages: extension.pages,
            menu: extension.menu,
          });
          owners.push(extension.id);
          for (const refusal of refusals) {
            console.warn(`[extensions] ${refusal.owner}: ${refusal.reason}`);
          }
        }
        relabelArrivals(windowModel, listed);
      })
      .catch((error: unknown) => {
        // No extension support, or a backend that has never heard of
        // the method: indistinguishable from none installed.
        console.info("[extensions] not listed:", error);
      });
    return () => {
      alive = false;
      for (const owner of owners) contributions.uninstall(owner);
    };
  }, [client, connected, windowModel, contributions, setExtensions]);

  return { contributions, extensions, setExtensions, extensionNames };
}

/** How often, and how far apart, a list the cloud's gateway cut off by a
 *  node move is asked for again. */
export const LIST_RETRIES = 5;
export const LIST_RETRY_MS = 500;

/** ``list_extensions``, asked again while the answer is a retryable
 *  error: on the desktop's cloud side a node move answers the call in
 *  flight with "igni's connection was moved" (``ConnectionMovedError``),
 *  and the connection is good again a moment later. Taken as "none
 *  installed", it emptied the nav and closed the open extension page
 *  until the next reconnect. */
async function listExtensions(client: Pick<IgniClient, "rpc">, alive: () => boolean): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.rpc<unknown>("list_extensions");
    } catch (error) {
      const retryable = (error as { retryable?: unknown } | null)?.retryable === true;
      if (!retryable || attempt >= LIST_RETRIES || !alive()) throw error;
      await new Promise((resolve) => setTimeout(resolve, LIST_RETRY_MS));
    }
  }
}

/** A page a link opened before its extension was listed carries its
 *  kind as its label (see ``chat/arrival.ts``); it has a name now. */
function relabelArrivals(
  windowModel: Pick<WindowModel, "get" | "write">,
  listed: readonly ExtensionSummary[],
): void {
  const named = new Map(listed.flatMap((e) => e.pages.map((p) => [p.kind, p.label] as const)));
  const route = windowModel.get("route");
  const stale = (r: (typeof route)[number]) => r.label === r.kind && named.has(r.kind);
  if (!route.some(stale)) return;
  windowModel.write(
    "route",
    route.map((r) => (stale(r) ? { ...r, label: named.get(r.kind) ?? r.label } : r)),
  );
}
