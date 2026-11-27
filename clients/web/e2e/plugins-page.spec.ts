/** Throwaway capture of the reworked Plugins marketplace (card grid). @manual. */

import { test, expect } from "./fixtures/embed";
import { signedInStatus, type FixtureBackend } from "./fixtures/backend";

const MARKET = {
  name: "igni-plugins",
  url: "https://github.com/ignite-ember/plugins",
  last_fetched: "2026-11-20",
  plugins: [
    {
      name: "api-security-testing",
      category: "security",
      source: "https://github.com/ignite-ember/plugins.git [api-sec]",
      description:
        "Automate API security directly in igni — audit OpenAPI specs, detect vulnerabilities aligned with OWASP API risks (incl. BOLA/BFLA), and apply AI-powered fixes in an audit→scan→remediate→validate loop.",
    },
    {
      name: "adobe-for-creativity",
      category: "design",
      source: "https://github.com/ignite-ember/plugins.git [adobe]",
      description:
        "Harness Adobe's creative AI tools to edit images, automate design workflows, and bring creative visions to life — from background removal to professional retouching.",
    },
    {
      name: "agent-sdk-dev",
      category: "development",
      source: "https://github.com/ignite-ember/plugins.git [sdk]",
      description: "Development kit for working with the igni Agent SDK.",
      version: "0.4.0",
    },
    {
      name: "agentforce-adlc",
      category: "development",
      source: "https://github.com/ignite-ember/plugins.git [adlc]",
      description: "Agent Development Life Cycle — author, discover, scaffold, deploy, test, and optimize .agent files.",
    },
    {
      name: "endor-labs",
      category: "security",
      source: "https://github.com/ignite-ember/plugins.git [endor]",
      description: "Set up endorctl and use Endor Labs to scan, prioritize, and fix security risks across your software supply chain.",
    },
    {
      name: "aikido",
      category: "security",
      source: "https://github.com/ignite-ember/plugins.git [aikido]",
      description: "Aikido Security scanning — SAST, secrets, and IaC vulnerability detection powered by the Aikido MCP server.",
    },
    {
      name: "airtable",
      category: "database",
      source: "https://github.com/ignite-ember/plugins.git [airtable]",
      description: "Read and write Airtable bases from your agent, with schema-aware queries.",
    },
    {
      name: "figma-sync",
      category: "design",
      source: "https://github.com/ignite-ember/plugins.git [figma]",
      description: "Pull designs, components and tokens from Figma straight into your project.",
      version: "1.2.1",
    },
  ],
};

function mock(be: FixtureBackend) {
  be.onRpc("get_status", () =>
    signedInStatus({ cloud_email: "dev@acme.com", cloud_connected: true, context_tokens: 0, max_context: 200_000 }),
  );
  be.onRpc("get_login_state", () => ({ logged_in: true, email: "dev@acme.com" }));
  be.onRpc("get_cloud_plan", () => ({ full_name: "Ada Lovelace" }));
  be.onRpc("get_marketplaces", () => [MARKET]);
  // One already installed, to show the "added" check state.
  be.onRpc("get_plugin_details", () => [{ name: "aikido", enabled: true }]);
  // A catalog entry's contents, for the detail page.
  be.onRpc("preview_plugin", () => ({
    root_path: "https://github.com/ignite-ember/plugins.git",
    readme:
      "# API Security Testing\n\nAudit OpenAPI specs and remediate findings directly inside igni.\n\n## Getting started\n\nRun `/plugin install api-security-testing` and point it at your spec.",
    agents: [
      { name: "api-auditor", description: "Audits an OpenAPI spec against OWASP API risks." },
      { name: "remediator", description: "Proposes and applies fixes for findings." },
    ],
    mcp_servers: [{ name: "owasp-zap", transport: "stdio", command: "zap-mcp" }],
    hooks: [{ event: "PreToolUse", count: 1 }],
    tools: [{ name: "scan_spec" }, { name: "validate_fix" }],
  }));
}

test.use({ viewport: { width: 1300, height: 940 } });

test("plugins marketplace grid", { tag: "@manual" }, async ({ page, backend, appUrl }) => {
  mock(backend);
  await page.goto(appUrl);
  await expect(page.locator(".composer-editable")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  // Open the Plugins page from the sidebar.
  await page.locator(".sidebar-link", { hasText: "Plugins" }).click();
  await expect(page.locator(".card-grid")).toBeVisible();
  await expect(page.locator(".entity-card").first()).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "account-shots/plugins-light.png" });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(200);
  await page.screenshot({ path: "account-shots/plugins-dark.png" });

  // The filter (category) dropdown.
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.locator(".control-menu")).toBeVisible();
  await page.waitForTimeout(150);
  await page.screenshot({ path: "account-shots/plugins-filter-menu.png" });
  await page.locator(".control-menu-backdrop").click();

  // The sort dropdown.
  await page.getByRole("button", { name: "Sort" }).click();
  await expect(page.locator(".control-menu")).toBeVisible();
  await page.waitForTimeout(150);
  await page.screenshot({ path: "account-shots/plugins-sort-menu.png" });
  await page.locator(".control-menu-backdrop").click();

  // The search expands inline from its icon.
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Search plugins" }).click();
  await expect(page.locator(".page-search")).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: "account-shots/plugins-search-open.png" });

  // Open a plugin's detail page to capture the polished hero.
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator(".entity-card", { hasText: "api-security-testing" }).click();
  await expect(page.locator(".entity-hero")).toBeVisible();
  await expect(page.locator(".entity-hero-chips")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "account-shots/plugin-detail-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: "account-shots/plugin-detail-dark.png" });
});
