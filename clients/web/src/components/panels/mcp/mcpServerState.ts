/** One server's state as its card and its page show it: the server's
 *  own details and its first-use approval read together. */

import type { McpApproval } from "./mcpApproval";
import { friendlyError, type McpServer } from "./mcpServer";

export type McpStatusKind = "connected" | "waiting" | "blocked" | "failed" | "disconnected";

const LABELS: Record<McpStatusKind, string> = {
  connected: "connected",
  waiting: "needs approval",
  blocked: "blocked by policy",
  failed: "failed",
  disconnected: "disconnected",
};

/** The dot beside the name: green when up, amber while waiting for
 *  approval, red when it failed or is refused, a quiet ring when off. */
const DOTS: Record<McpStatusKind, string> = {
  connected: "done",
  waiting: "running mcp-waiting",
  blocked: "error",
  failed: "error",
  disconnected: "mcp-idle",
};

export class McpServerState {
  constructor(
    readonly server: McpServer,
    readonly approval: McpApproval | undefined,
  ) {}

  get kind(): McpStatusKind {
    const s = this.server;
    if (s.connected) return "connected";
    if (this.approval?.waiting) return "waiting";
    if (s.policyBlocked) return "blocked";
    return s.error ? "failed" : "disconnected";
  }

  /** The status chip's word. */
  get label(): string {
    return LABELS[this.kind];
  }

  /** The `.tool-status` classes of the dot. */
  get dot(): string {
    return DOTS[this.kind];
  }

  /** Refused until approved: it cannot be connected from here. */
  get waiting(): boolean {
    return this.kind === "waiting";
  }

  /** The sentence under the name, when there is something to say: why
   *  it failed, or whose approval it waits for. */
  get sentence(): string {
    const kind = this.kind;
    if (kind === "waiting" && this.approval) return this.approval.waitingStatus;
    if (kind === "blocked") return "An administrator policy forbids using this server.";
    if (kind === "failed") return friendlyError(this.server.error);
    return "";
  }

  /** Where it is configured: `project`, `user`, `plugin`, … */
  get source(): string {
    return this.approval?.source ?? "";
  }

  /** The file that configures it. */
  get sourcePath(): string {
    return this.approval?.sourcePath ?? "";
  }

  /** The main thing to do next, or `null` when the page offers none:
   *  approve a waiting server, connect one that is off, reconnect one
   *  that failed, disconnect one that is up. */
  get primaryAction(): "approve" | "connect" | "reconnect" | "disconnect" | null {
    const kind = this.kind;
    if (kind === "waiting") return "approve";
    if (kind === "connected") return "disconnect";
    if (kind === "blocked") return null;
    return kind === "failed" ? "reconnect" : "connect";
  }

  /** The approval can be withdrawn from here. */
  get revocable(): boolean {
    return this.approval?.revocable === true;
  }
}
