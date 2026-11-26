/** The MCP servers as `get_mcp_server_details` lists them, read at the boundary. */

import { countOf } from "../../../lib/plural";
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

/** A tool's name with its server prefix split off. Two spellings reach
 *  the panel: the registry's ``mcp_<server>_<tool>`` (igni-core's
 *  ``tool_name_prefix``), which needs the server's name to split since
 *  both halves may contain ``_``, and the older ``<server>__<tool>``. */
export class McpToolName {
  private static readonly PREFIXED = /^([a-zA-Z0-9_-]+)__(.+)$/;

  constructor(
    readonly short: string,
    readonly prefix?: string,
  ) {}

  static of(full: string, server?: string): McpToolName {
    if (server) {
      const registered = `mcp_${server}_`;
      if (full.startsWith(registered) && full.length > registered.length) {
        return new McpToolName(full.slice(registered.length), server);
      }
    }
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

  /** What it offers, e.g. ``2 tools · 1 resource``. */
  get summary(): string {
    return [
      countOf(this.toolNames.length, "tool"),
      this.resources.length ? countOf(this.resources.length, "resource") : "",
      this.prompts.length ? countOf(this.prompts.length, "prompt") : "",
    ]
      .filter(Boolean)
      .join(" · ");
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

/** A connection error as a sentence a person can act on.
 *
 *  The backend hands up whatever the transport raised — a Python
 *  `[Errno 2] …` or an httpx message. The common ones get a plain
 *  sentence that says what to check; anything else is shown as it came,
 *  since a guess is worse than the original. The raw text stays on the
 *  server for a tooltip. */
export function friendlyError(raw: string): string {
  const missing = raw.match(/\[Errno 2\] No such file or directory: '([^']+)'/);
  if (missing) {
    return `Couldn't start “${missing[1]}”: command not found. Install it, or fix the command in .mcp.json.`;
  }
  if (/All connection attempts failed|Connection refused|ConnectError|Name or service not known/i.test(raw)) {
    return "Couldn't reach the server — nothing answered at its address. Check it is running, or fix the url in .mcp.json.";
  }
  if (/timed? ?out|TimeoutError/i.test(raw)) {
    return "The server didn't answer in time. Check it is running and reachable.";
  }
  const status = raw.match(/\b(401|403)\b/);
  if (status) {
    return `The server refused the credentials (${raw.trim()}). Check its token in .mcp.json.`;
  }
  return raw;
}

function stringList(p: WirePayload, key: string): string[] {
  return p.list(key).filter((v): v is string => typeof v === "string");
}
