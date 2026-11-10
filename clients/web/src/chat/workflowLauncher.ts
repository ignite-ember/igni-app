/**
 * Starting a workflow run, from ``/workflows <name> [json-args]`` or a
 * card's Rerun — one path, so both open the card the same way: when
 * ``run_workflow`` answers, under the run id it answered with.
 *
 * ``/workflows`` never reaches the backend's command dispatcher; this
 * client intercepts it.
 */

import type { IgniClient } from "../protocol/client";
import { RunWorkflowResult } from "../protocol/rpcResults";
import { WirePayload } from "../protocol/wirePayload";

export type WorkflowCommand =
  /** Not a ``/workflows`` command. */
  | { kind: "none" }
  /** No name: the listing, which is a page. */
  | { kind: "list" }
  | { kind: "run"; name: string; args: Record<string, unknown> }
  | { kind: "invalid"; error: string };

const WORKFLOWS_COMMAND = /^\/workflows(?:\s+(\S+))?(?:\s+(\{[\s\S]*\}))?$/;

export class WorkflowLauncher {
  constructor(private readonly client: Pick<IgniClient, "rpc" | "sessionId">) {}

  static parseCommand(text: string): WorkflowCommand {
    const match = WORKFLOWS_COMMAND.exec(text.trim());
    if (!match) return { kind: "none" };
    const [, name, rawArgs] = match;
    if (!name) return { kind: "list" };
    if (!rawArgs) return { kind: "run", name, args: {} };
    try {
      const parsed: unknown = JSON.parse(rawArgs);
      return { kind: "run", name, args: WirePayload.isRecord(parsed) ? parsed : {} };
    } catch (err) {
      return { kind: "invalid", error: String(err) };
    }
  }

  /** Start ``name`` in this window's session. Throws when the backend
   *  refuses, as the RPC does. */
  async start(name: string, args: Record<string, unknown> = {}): Promise<RunWorkflowResult> {
    return RunWorkflowResult.parse(
      await this.client.rpc<unknown>("run_workflow", {
        name,
        args,
        session_id: this.client.sessionId,
      }),
    );
  }
}
