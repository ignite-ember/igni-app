/** What the open plugin bundles: its installed copy's, or a preview of
 *  its catalog source. */

import { useEffect, useState } from "react";
import type { ContentsLoad, PluginContents } from "./pluginContents";
import type { PluginsApi } from "./pluginsApi";
import type { PluginsResult } from "./pluginWire";
import type { ResolvedPlugin } from "./pluginSelection";

const LOADING: ContentsLoad = { kind: "loading" };

/**
 * Re-read when what would be read changes: another plugin, or the same
 * one becoming installed. The effect keys on those primitives rather
 * than on ``resolved``, which is rebuilt on every render. With no plugin
 * open it rests at loading, so the next page never shows the last one's.
 */
export function usePluginContents(api: PluginsApi, resolved: ResolvedPlugin | null): ContentsLoad {
  const [contents, setContents] = useState<ContentsLoad>(LOADING);

  const installedName = resolved?.kind === "installed" ? resolved.plugin.name : null;
  const previewSource = resolved?.kind === "catalog" ? resolved.plugin.source : null;
  const previewBranch = resolved?.kind === "catalog" ? resolved.plugin.branch || null : null;

  useEffect(() => {
    setContents(LOADING);
    let request: Promise<PluginsResult<PluginContents>>;
    if (installedName !== null) request = api.contents(installedName);
    else if (previewSource !== null) request = api.preview(previewSource, previewBranch);
    else return;
    let cancelled = false;
    void request.then((r) => {
      if (cancelled) return;
      setContents(
        r.ok ? { kind: "loaded", contents: r.value } : { kind: "failed", reason: r.reason },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [api, installedName, previewSource, previewBranch]);

  return contents;
}
