/**
 * An {@link RpcCaller} bound to one extension.
 *
 * A class rather than a bound function because the binding is the
 * whole point: there is no way to call through this without the
 * caller being set, and no fourth positional argument for anybody to
 * forget. Obtained from `IgniClient.asExtension`.
 */

import { RPC_TIMEOUT_MS, type RpcCaller } from "./rpcCaller";

export class ExtensionCaller {
  constructor(
    private readonly client: RpcCaller,
    readonly extensionId: string,
  ) {}

  /** Call a backend method as this extension. */
  rpc<T = unknown>(
    method: string,
    args: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<T> {
    return this.client.rpc<T>(method, args, timeoutMs ?? RPC_TIMEOUT_MS, this.extensionId);
  }
}
