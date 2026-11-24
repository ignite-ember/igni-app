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

const MCP_SERVERS = [
  {
    name: "github",
    connected: true,
    transport: "stdio",
    tool_names: ["create_pr", "list_issues", "merge_pr"],
    tool_descriptions: {
      create_pr: "Open a pull request from the current branch.",
      list_issues: "List open issues on a repository.",
      merge_pr: "Merge an approved pull request.",
    },
    tools_disabled: [],
    resources: [],
    prompts: [],
    error: "",
    policy_blocked: false,
  },
  {
    name: "postgres",
    connected: true,
    transport: "sse",
    tool_names: ["query", "list_tables"],
    tool_descriptions: { query: "Run a read-only SQL query." },
    tools_disabled: [],
    resources: [{ uri: "schema://public", name: "public schema" }],
    prompts: [],
    error: "",
    policy_blocked: false,
  },
  {
    name: "sentry",
    connected: true,
    transport: "stdio",
    tool_names: ["list_errors", "resolve"],
    tool_descriptions: { list_errors: "List unresolved errors in a project." },
    tools_disabled: ["resolve"],
    resources: [],
    prompts: [],
    error: "",
    policy_blocked: false,
  },
  {
    name: "linear",
    connected: false,
    transport: "stdio",
    tool_names: [],
    tool_descriptions: {},
    tools_disabled: [],
    resources: [],
    prompts: [],
    error: "",
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
    error: "disconnected",
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
