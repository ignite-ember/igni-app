/**
 * This window as an observer of its session: every broadcast — other
 * views' messages and answers, pushes, runs it did not start — goes to
 * the {@link MirrorEventRouter}.
 */

import { useEffect } from "react";

import type { IgniClient } from "../protocol/client";
import type { MirrorEventRouter } from "./mirrorEventRouter";

export function useObserver(client: Pick<IgniClient, "onEvent">, mirror: MirrorEventRouter): void {
  useEffect(() => client.onEvent((m) => mirror.route(m)), [client, mirror]);
}
