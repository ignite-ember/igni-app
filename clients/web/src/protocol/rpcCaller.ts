/**
 * The one call every backend RPC goes through, as the classes built on
 * top of {@link IgniClient} see it.
 */

/** How long an RPC waits for its reply unless told otherwise. */
export const RPC_TIMEOUT_MS = 60_000;

export interface RpcCaller {
  /** Call ``method`` with ``args``; ``caller`` names the extension asking. */
  rpc<T = unknown>(
    method: string,
    args?: Record<string, unknown>,
    timeoutMs?: number,
    caller?: string,
  ): Promise<T>;
}
