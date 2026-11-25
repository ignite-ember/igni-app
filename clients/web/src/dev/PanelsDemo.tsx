/**
 * UI sandbox for the MCPs and Extensions panels (``?demo=panels``, see
 * main.tsx). Renders the real panels with canned data and a mock client,
 * in page mode (full width, like the app), so the card grid and the
 * filter/sort/search controls can be seen populated without a backend.
 */

import { useState } from "react";

import type { ExtensionSummary } from "../extensions/ExtensionPage";
import type { PageRoute } from "../chat/pageStack";
import type { IgniClient } from "../protocol/client";
import { ExtensionsPanel } from "../components/panels/ExtensionsPanel";
import { McpPanel } from "../components/panels/McpPanel";
import { PageContext } from "../components/PageShell";

// The shapes the live backend returns: tool names carry the registry's
// `mcp_<server>_` prefix, and a server that failed carries the
// transport's raw error.
const MCP_SERVERS = [
  {
    name: "github",
    connected: true,
    transport: "stdio",
    tool_names: ["mcp_github_list_issues", "mcp_github_create_pr", "mcp_github_merge_pr"],
    tool_descriptions: {
      mcp_github_list_issues: "List open issues on a repository.",
      mcp_github_create_pr: "Open a pull request from a branch.",
      mcp_github_merge_pr: "Merge an approved pull request.",
    },
    tools_disabled: ["mcp_github_merge_pr"],
    resources: [{ uri: "repo://acme/web", name: "repo_readme", description: "The web repository's README." }],
    prompts: [{ name: "triage", description: "Triage an issue into a label and a priority.", arguments: ["issue"] }],
    error: "",
    policy_blocked: false,
  },
  {
    name: "postgres",
    connected: true,
    transport: "stdio",
    tool_names: ["mcp_postgres_query", "mcp_postgres_list_tables"],
    tool_descriptions: {
      mcp_postgres_query: "Run a read-only SQL query.",
      mcp_postgres_list_tables: "List the tables in the public schema.",
    },
    tools_disabled: [],
    resources: [{ uri: "schema://public", name: "public_schema" }],
    prompts: [],
    error: "",
    policy_blocked: false,
  },
  {
    name: "linear",
    connected: true,
    transport: "stdio",
    tool_names: ["mcp_linear_list_tickets", "mcp_linear_create_ticket"],
    tool_descriptions: {
      mcp_linear_list_tickets: "List a team's open tickets.",
      mcp_linear_create_ticket: "Create a ticket on a team.",
    },
    tools_disabled: [],
    resources: [],
    prompts: [{ name: "standup", description: "Summarise yesterday's ticket movement.", arguments: [] }],
    error: "",
    policy_blocked: false,
  },
  {
    name: "sentry",
    connected: false,
    transport: "stdio",
    tool_names: [],
    tool_descriptions: {},
    tools_disabled: [],
    resources: [],
    prompts: [],
    error: "[Errno 2] No such file or directory: 'mcp-server-sentry'",
    policy_blocked: false,
  },
  {
    name: "stripe",
    connected: false,
    transport: "sse",
    tool_names: [],
    tool_descriptions: {},
    tools_disabled: [],
    resources: [],
    prompts: [],
    error: "",
    policy_blocked: false,
  },
];

const EXTENSIONS: ExtensionSummary[] = [
  {
    id: "jira-for-igni",
    name: "Jira for igni",
    version: "2.1.0",
    state: "ready",
    reason: "",
    settings: [],
    pages: [],
    menu: [],
    indicators: [],
    values: {},
    tools: [],
  },
  {
    id: "sentry-alerts",
    name: "Sentry Alerts",
    version: "0.9.3",
    state: "failed",
    reason: "Token rejected by the Sentry API — reconnect to refresh it.",
    settings: [],
    pages: [],
    menu: [],
    indicators: [],
    values: {},
    tools: [],
  },
  {
    id: "figma-bridge",
    name: "Figma Bridge",
    version: "1.4.0",
    state: "busy",
    reason: "",
    settings: [
      { key: "team", type: "string", label: "Team URL", default: "" },
      {
        key: "quality",
        type: "enum",
        label: "Export quality",
        default: "high",
        options: ["low", "medium", "high"],
      },
      { key: "pollMinutes", type: "number", label: "Check every (min)", default: 15 },
      { key: "autoExport", type: "boolean", label: "Export on save", default: true },
    ],
    pages: [{ kind: "figma.board", label: "Boards", sidebar: true }],
    menu: [{ command: "/figma", desc: "pull the latest frames for the current screen" }],
    indicators: [],
    values: {
      team: "https://figma.com/team/acme",
      quality: "high",
      pollMinutes: 15,
      autoExport: true,
    },
    tools: [],
  },
  {
    id: "datadog-monitors",
    name: "Datadog Monitors",
    version: "3.0.1",
    state: "ready",
    reason: "",
    settings: [],
    pages: [],
    menu: [],
    indicators: [],
    values: {},
    tools: [],
  },
] as unknown as ExtensionSummary[];

/** A client that answers only the reads these two panels make. */
const mockClient = {
  rpc: async (method: string) => {
    if (method === "get_mcp_server_details") return MCP_SERVERS;
    if (method === "list_mcp_approvals") return {};
    if (method === "set_extension_settings") return { extensions: EXTENSIONS };
    return {};
  },
} as unknown as IgniClient;

export function PanelsDemo() {
  const [tab, setTab] = useState<"mcp" | "extensions">("mcp");
  const route: PageRoute = { kind: tab, label: tab === "mcp" ? "MCPs" : "Extensions" };
  const page = { trail: [route], onCrumb: () => {}, onBack: () => {}, onClose: () => {} };

  return (
    <div className="shell">
      <main className="main main--paged">
        <header className="app-header">
          <div className="demo-panels-switch">
            <button className={tab === "mcp" ? "active" : ""} onClick={() => setTab("mcp")}>
              MCPs
            </button>
            <button
              className={tab === "extensions" ? "active" : ""}
              onClick={() => setTab("extensions")}
            >
              Extensions
            </button>
          </div>
        </header>
        <PageContext.Provider value={page}>
          {tab === "mcp" ? (
            <McpPanel client={mockClient} onClose={() => {}} onAddServer={() => {}} />
          ) : (
            <ExtensionsPanel
              client={mockClient}
              extensions={EXTENSIONS}
              onChanged={() => {}}
              onClose={() => {}}
            />
          )}
        </PageContext.Provider>
      </main>
    </div>
  );
}
