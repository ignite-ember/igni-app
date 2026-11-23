/** Throwaway capture of the card-styled Extensions and MCP panels. @manual. */

import { test, expect } from "./fixtures/embed";
import { signedInStatus, type FixtureBackend } from "./fixtures/backend";

const EXTENSIONS = [
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
    ],
    pages: [],
    menu: [],
    indicators: [],
    values: { team: "https://figma.com/team/acme" },
    tools: [],
  },
];

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
];

function mock(be: FixtureBackend) {
  be.onRpc("get_status", () =>
    signedInStatus({ cloud_email: "dev@acme.com", cloud_connected: true, context_tokens: 0, max_context: 200_000 }),
  );
  be.onRpc("get_login_state", () => ({ logged_in: true, email: "dev@acme.com" }));
  be.onRpc("get_cloud_plan", () => ({ full_name: "Ada Lovelace" }));
  be.onRpc("list_extensions", () => ({ extensions: EXTENSIONS }));
  be.onRpc("ensure_mcp", () => ({}));
  be.onRpc("get_mcp_server_details", () => MCP_SERVERS);
  be.onRpc("list_mcp_approvals", () => ({}));
}

test.use({ viewport: { width: 1300, height: 940 } });

test("panels card lists", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  mock(backend);
  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });

  await page.locator(".sidebar-link", { hasText: "Extensions" }).click();
  await expect(page.locator(".ext-row").first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "account-shots/extensions-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: "account-shots/extensions-dark.png" });

  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".sidebar-link", { hasText: "MCPs" }).click();
  await expect(page.locator(".mcp-server").first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "account-shots/mcp-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: "account-shots/mcp-dark.png" });
});
