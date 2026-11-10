/** The MCP servers as `get_mcp_server_details` lists them, read at the boundary. */

import { WirePayload } from "../../../protocol/wirePayload";

/** A resource a server exposes. */
export class McpResource {
  constructor(
    readonly uri: string,
    readonly name: string,
    readonly description: string,
    readonly mimeType: string,
  ) {}

  static parse(raw: unknown): McpResource {
    const p = new WirePayload(raw);
    return new McpResource(
      p.string("uri"),
      p.string("name"),
      p.string("description"),
      p.string("mime_type"),
    );
  }

  /** What the row is called: its name, or its uri when it has none. */
  get label(): string {
    return this.name || this.uri;
  }

  /** The mime type and uri, whichever are known. */
  get meta(): string {
    return [this.mimeType, this.uri].filter(Boolean).join(" · ");
  }
}

/** A prompt template a server exposes. */
export class McpPrompt {
  constructor(
    readonly name: string,
    readonly description: string,
    readonly args: readonly string[],
  ) {}

  static parse(raw: unknown): McpPrompt {
    const p = new WirePayload(raw);
    return new McpPrompt(
      p.string("name"),
      p.string("description"),
      stringList(p, "arguments"),
    );
  }
}

/** A tool's name with the server prefix Agno adds split off
 *  (``filesystem__read_file`` → ``read_file`` and ``filesystem``). */
export class McpToolName {
  private static readonly PREFIXED = /^([a-zA-Z0-9_-]+)__(.+)$/;

  constructor(
    readonly short: string,
    readonly prefix?: string,
  ) {}

  static of(full: string): McpToolName {
    const m = full.match(McpToolName.PREFIXED);
    return m ? new McpToolName(m[2], m[1]) : new McpToolName(full);
  }
}

export class McpServer {
  constructor(
    readonly name: string,
    readonly connected: boolean,
    readonly transport: string,
    readonly toolNames: readonly string[],
    readonly toolDescriptions: Readonly<Record<string, string>>,
    readonly toolsDisabled: ReadonlySet<string>,
    readonly resources: readonly McpResource[],
    readonly prompts: readonly McpPrompt[],
    readonly error: string,
    readonly policyBlocked: boolean,
  ) {}

  static parse(raw: unknown): McpServer {
    const p = new WirePayload(raw);
    const descriptions = new WirePayload(p.plainObject("tool_descriptions"));
    const toolNames = stringList(p, "tool_names");
    return new McpServer(
      p.text("name", "?"),
      p.flag("connected"),
      p.text("transport", "unknown"),
      toolNames,
      Object.fromEntries(
        toolNames.flatMap((t) => {
          const d = descriptions.optionalString(t);
          return d === undefined ? [] : [[t, d]];
        }),
      ),
      new Set(stringList(p, "tools_disabled")),
      p.list("resources").map(McpResource.parse),
      p.list("prompts").map(McpPrompt.parse),
      p.value("error") ? p.text("error") : "",
      p.flag("policy_blocked"),
    );
  }

  static parseList(raw: unknown): McpServer[] {
    return Array.isArray(raw) ? raw.map(McpServer.parse) : [];
  }

  /** Whether there is anything to show when the row is opened. */
  get expandable(): boolean {
    return (
      this.toolNames.length + this.resources.length + this.prompts.length > 0
    );
  }

  /** What it offers, e.g. ``2 tools · 1 resources``. */
  get summary(): string {
    return [
      `${this.toolNames.length} tools`,
      this.resources.length ? `${this.resources.length} resources` : "",
      this.prompts.length ? `${this.prompts.length} prompts` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  /** The one line under the server's name. */
  get status(): string {
    if (this.policyBlocked) return "blocked by policy";
    if (this.connected) return `${this.summary} — click to expand`;
    return this.error || "disconnected";
  }

  isToolDisabled(tool: string): boolean {
    return this.toolsDisabled.has(tool);
  }

  /** This server with ``tool`` shown to or hidden from the agent. */
  withTool(tool: string, enabled: boolean): McpServer {
    const disabled = new Set(this.toolsDisabled);
    if (enabled) disabled.delete(tool);
    else disabled.add(tool);
    return new McpServer(
      this.name,
      this.connected,
      this.transport,
      this.toolNames,
      this.toolDescriptions,
      disabled,
      this.resources,
      this.prompts,
      this.error,
      this.policyBlocked,
    );
  }
}

function stringList(p: WirePayload, key: string): string[] {
  return p.list(key).filter((v): v is string => typeof v === "string");
}
