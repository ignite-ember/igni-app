/**
 * What the backend addresses to installed extensions' frames.
 *
 * The `host_signal` push: a host-model signal an extension's page
 * subscribed to, for the bridge's `on(signal, fn)`
 * (`docs/HOST_OBJECT_MODEL.md`). The backend already decided who was
 * entitled to hear each one; this only routes it.
 *
 * Kept as per-extension queues with a monotonic `n` rather than "the
 * latest one", because two pushes that land in the same React batch
 * collapse into one render, and a single slot drops whichever came
 * first. Bounded: a frame that is closed must not turn a chatty
 * producer into a growing array nobody reads.
 */

import { useEffect, useState } from "react";

import type { IgniClient } from "../protocol/client";
import { parsePushChannel, type HostSignal } from "../protocol/pushChannels";

/** How many undelivered items one extension's queue keeps. */
export const EXTENSION_TRAFFIC_BACKLOG = 64;

export interface ExtensionSignalItem {
  signal: string;
  value: unknown;
  n: number;
}

/** Every extension's bounded signal queue. Immutable: each signal
 *  yields a new instance, so React sees the change. */
export class ExtensionSignalQueues {
  constructor(readonly byExtension: Readonly<Record<string, ExtensionSignalItem[]>> = {}) {}

  with(signal: HostSignal): ExtensionSignalQueues {
    const queue = this.byExtension[signal.extensionId] ?? [];
    const item: ExtensionSignalItem = {
      signal: signal.signal,
      value: signal.value,
      n: (queue[queue.length - 1]?.n ?? 0) + 1,
    };
    return new ExtensionSignalQueues({
      ...this.byExtension,
      [signal.extensionId]: [...queue, item].slice(-EXTENSION_TRAFFIC_BACKLOG),
    });
  }
}

export function useExtensionTraffic(
  client: IgniClient,
  connected: boolean,
): {
  signals: Readonly<Record<string, ExtensionSignalItem[]>>;
} {
  const [queues, setQueues] = useState(() => new ExtensionSignalQueues());

  useEffect(() => {
    if (!connected) return;
    return client.onEvent((message) => {
      if (message.type !== "push_notification") return;
      const ev = parsePushChannel(message);
      if (ev?.channel !== "host_signal") return;
      setQueues((current) => current.with(ev));
    });
  }, [client, connected]);

  return { signals: queues.byExtension };
}
