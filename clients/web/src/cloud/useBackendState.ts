/**
 * The shell's switch state for this window: asked once on mount, then
 * every push. `null` outside the desktop app, where there is no switch.
 */

import { useEffect, useState } from "react";

import { host } from "../lib/host";
import { BackendSnapshot } from "./backendState";

export function useBackendState(): BackendSnapshot | null {
  const [snapshot, setSnapshot] = useState<BackendSnapshot | null>(null);
  useEffect(() => {
    let live = true;
    const off = host.onBackendState((raw) => {
      const next = BackendSnapshot.parse(raw);
      if (next) setSnapshot(next);
    });
    void host.backendState().then((raw) => {
      const first = BackendSnapshot.parse(raw);
      if (live && first) setSnapshot((current) => current ?? first);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return snapshot;
}
