/** A configured MCP server's first-use approval, as `list_mcp_approvals`
 *  and `set_mcp_approval` answer it, read at the boundary. */

import { WirePayload } from "../../../protocol/wirePayload";

export class McpApproval {
  constructor(
    readonly name: string,
    /** Where it is configured: `user`, `project`, `plugin`, `managed`… */
    readonly source: string,
    readonly sourcePath: string,
    readonly approved: boolean,
  ) {}

  static parse(raw: unknown): McpApproval {
    const p = new WirePayload(raw);
    return new McpApproval(p.text("name"), p.text("source"), p.text("source_path"), p.flag("approved"));
  }

  /** By server name; rows without one are dropped. */
  static parseMap(raw: unknown): Map<string, McpApproval> {
    const rows = Array.isArray(raw) ? raw.map(McpApproval.parse) : [];
    return new Map(rows.filter((r) => r.name).map((r) => [r.name, r]));
  }

  /** Never connected until the person approves it. */
  get waiting(): boolean {
    return !this.approved;
  }

  /** The person's own `~/.igni/.mcp.json` is always trusted: its
   *  approval cannot be withdrawn. */
  get revocable(): boolean {
    return this.approved && this.source !== "user";
  }

  /** The line under the name of a server waiting for its approval. */
  get waitingStatus(): string {
    const from = this.sourcePath || this.source;
    return from ? `waiting for your approval · ${from}` : "waiting for your approval";
  }
}
