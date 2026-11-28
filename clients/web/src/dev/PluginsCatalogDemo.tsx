/**
 * UI sandbox for the plugins marketplace (``?demo=plugins``, see main.tsx).
 * Renders the real catalog header and card grid with canned data that
 * carries categories, so the category-icon avatars and the category
 * filter can be seen without a backend. Framed by the real `PageShell`
 * under a real app header, so it scrolls and fades as the app does.
 */

import { useState } from "react";

import {
  ALL_CATEGORIES,
  applyCatalogView,
  categoriesOf,
  type SortKey,
} from "../components/panels/plugins/catalogView";
import { PageShell } from "../components/PageShell";
import { InstalledPlugins } from "../components/panels/plugins/installedPlugin";
import { InstalledTab } from "../components/panels/plugins/InstalledTab";
import { MarketplaceCatalog } from "../components/panels/plugins/marketplace";
import { MarketplaceTab } from "../components/panels/plugins/MarketplaceTab";
import { CatalogControls } from "../components/panels/plugins/PluginsChrome";
import { TopBlur } from "../components/page/TopBlur";

const CATALOG = MarketplaceCatalog.parse([
  {
    name: "claude-plugins-official",
    url: "github.com/anthropics/claude-plugins-official",
    last_fetched: "2026-11-24T00:00:00Z",
    plugins: [
      {
        name: "api-security-testing",
        description: "Audit OpenAPI specs and catch security issues before they ship.",
        version: "1.2.0",
        source: "github.com/acme/api-sec",
        branch: "",
        category: "security",
      },
      {
        name: "postgres-toolkit",
        description: "Query, migrate and inspect Postgres from chat.",
        version: "3.1.0",
        source: "github.com/acme/pg",
        branch: "",
        category: "database",
      },
      {
        name: "design-handoff",
        description: "Pull the latest frames for the screen you are on.",
        version: "0.9.0",
        source: "github.com/acme/design",
        branch: "",
        category: "design",
      },
      {
        name: "agent-sdk-dev",
        description: "Scaffolding and helpers for building agents.",
        version: "2.0.1",
        source: "github.com/acme/sdk",
        branch: "",
        category: "development",
      },
      {
        name: "uptime-watch",
        description: "Alert the channel the moment an endpoint goes down.",
        version: "1.0.0",
        source: "github.com/acme/uptime",
        branch: "",
        category: "monitoring",
      },
      {
        name: "focus-timer",
        description: "A Pomodoro timer and a daily plan that follows your commits.",
        version: "1.4.0",
        source: "github.com/acme/focus",
        branch: "",
        category: "productivity",
      },
      {
        name: "ship-it",
        description: "One-command deploys to any of your clouds.",
        version: "2.2.0",
        source: "github.com/acme/ship",
        branch: "",
        category: "deployment",
      },
      {
        name: "nightly-automation",
        description: "Run chores on a schedule and report back.",
        version: "1.1.0",
        source: "github.com/acme/cron",
        branch: "",
        category: "automation",
      },
      {
        name: "tutor",
        description: "Explain the codebase and quiz you on it.",
        version: "0.6.0",
        source: "github.com/acme/tutor",
        branch: "",
        category: "learning",
      },
      {
        name: "geo-tools",
        description: "Geocode and map the addresses in your data.",
        version: "1.0.0",
        source: "github.com/acme/geo",
        branch: "",
        category: "location",
      },
      {
        name: "unit-forge",
        description: "Generate and run unit tests for changed files.",
        version: "2.0.0",
        source: "github.com/acme/tests",
        branch: "",
        category: "testing",
      },
      {
        name: "calc-kit",
        description: "Symbolic math and quick numeric helpers.",
        version: "0.8.0",
        source: "github.com/acme/calc",
        branch: "",
        category: "math",
      },
      {
        name: "schema-migrate",
        description: "Plan and apply database migrations safely.",
        version: "3.0.0",
        source: "github.com/acme/migrate",
        branch: "",
        category: "migration",
      },
      {
        name: "misc-helper",
        description: "A grab-bag of small utilities with no home of their own.",
        version: "0.3.0",
        source: "github.com/acme/misc",
        branch: "",
        category: "",
      },
    ],
  },
]);

const INSTALLED = InstalledPlugins.parse([
  {
    name: "commit-helper",
    description: "Draft conventional commit messages from the staged diff.",
    version: "1.3.0",
    enabled: true,
    source_root: "github.com/acme/commit-helper",
    has_agents: true,
    has_hooks: true,
  },
  {
    name: "sql-explorer",
    description: "Browse and query the project's database.",
    version: "2.0.0",
    enabled: true,
    source_root: "github.com/acme/sql-explorer",
    has_skills: true,
    has_mcp: true,
  },
  {
    name: "legacy-linter",
    description: "An older linter, kept off until its rules are updated.",
    version: "0.4.0",
    enabled: false,
    source_root: "github.com/acme/legacy-linter",
    has_tools: true,
  },
]);

const TRAIL = [{ kind: "plugins", label: "Plugins" }];

export function PluginsCatalogDemo() {
  const [view, setView] = useState<"marketplace" | "installed">("marketplace");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("default");
  const [filterBy, setFilterBy] = useState<string>(ALL_CATEGORIES);

  const categories = categoriesOf(CATALOG.entries());
  const entries = applyCatalogView(CATALOG.filter(query), sortBy, filterBy);

  return (
    <div className="shell">
      <main className="main main--paged" style={{ position: "relative" }}>
        <header className="app-header">
          <div className="app-header-blur" aria-hidden="true">
            <TopBlur />
          </div>
          <div className="header-crumbs" id="app-header-crumbs" />
          <div className="header-spacer" />
        </header>
        <PageShell
          trail={TRAIL}
          title="Plugins"
          headerExtras={
            <div className="page-headerbar">
              <div className="page-tabs">
                <button
                  className={`page-tab ${view === "marketplace" ? "active" : ""}`}
                  onClick={() => setView("marketplace")}
                >
                  Marketplace<span className="page-tab-count">{CATALOG.pluginCount}</span>
                </button>
                <button
                  className={`page-tab ${view === "installed" ? "active" : ""}`}
                  onClick={() => setView("installed")}
                >
                  Installed<span className="page-tab-count">{INSTALLED.count}</span>
                </button>
              </div>
              {view === "marketplace" && (
                <CatalogControls
                  pluginCount={CATALOG.pluginCount}
                  marketCount={CATALOG.marketCount}
                  query={query}
                  onQueryChange={setQuery}
                  categories={categories}
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                  filterBy={filterBy}
                  onFilterChange={setFilterBy}
                  refreshing={false}
                  onRefresh={() => {}}
                  onManage={() => {}}
                />
              )}
            </div>
          }
          onCrumb={() => {}}
          onBack={() => {}}
          onClose={() => {}}
        >
          {view === "marketplace" ? (
            <MarketplaceTab
              catalog={CATALOG}
              entries={entries}
              installed={INSTALLED}
              isRunning={() => false}
              onInstall={() => {}}
              onOpen={() => {}}
            />
          ) : (
            <InstalledTab
              installed={INSTALLED}
              installRef=""
              onInstallRefChange={() => {}}
              installing={false}
              onInstall={() => {}}
              onOpen={() => {}}
            />
          )}
        </PageShell>
      </main>
    </div>
  );
}
