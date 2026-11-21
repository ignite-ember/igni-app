/**
 * How many times the client has become connected, as a render value: it
 * changes on every connect, including the resync a second `welcome`
 * makes after a node move (design §4.3, §15.5).
 */

import { useEffect, useState } from "react";

import type { IgniClient } from "../protocol/client";

export function useConnectionGeneration(client: Partial<Pick<IgniClient, "onStateChange" | "generation">>): number {
  const [generation, setGeneration] = useState(client.generation ?? 0);
  useEffect(() => {
    if (!client.onStateChange) return;
    return client.onStateChange((s) => {
      if (s === "connected") setGeneration(client.generation ?? 0);
    });
  }, [client]);
  return generation;
}
