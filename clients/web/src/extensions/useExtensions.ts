/**
 * What is installed, and the app's navigation with it folded in.
 *
 * The {@link Contributions} registry is this window's, made once per
 * mount — not module scope, so two mounts (StrictMode, a test) never
 * share one. The list is held in state as well, because the nav needs
 * only the labels and an extension's page needs the rest: the origin to
 * frame, the grants, its state and why.
 */

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { PageRegistry } from "../chat/pageStack";
import type { WindowModel } from "../clientState";
import type { IgniClient } from "../protocol/client";
import { ListExtensionsResult } from "../protocol/rpcResults";
import { BASE_SIDEBAR_LINKS, BASE_TOOLS_MENU } from "./baseNavigation";
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
): Extensions {
  const contributions = useMemo(
    () => new Contributions(BASE_SIDEBAR_LINKS, BASE_TOOLS_MENU, new PageRegistry()),
    [],
  );
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
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
    void client
      .rpc<unknown>("list_extensions")
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
  }, [client, connected, windowModel, contributions]);

  return { contributions, extensions, setExtensions, extensionNames };
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
