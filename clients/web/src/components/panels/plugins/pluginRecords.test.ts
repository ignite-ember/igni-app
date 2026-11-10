import { describe, expect, it } from "vitest";

import { InstalledPlugins } from "./installedPlugin";
import { PluginAbout } from "./pluginAbout";
import { PluginAction } from "./pluginAction";
import { PluginContents } from "./pluginContents";
import { WirePayload } from "../../../protocol/wirePayload";

describe("InstalledPlugins.parse", () => {
  it("reads get_plugin_details' list, in order, with each plugin's chips", () => {
    const installed = InstalledPlugins.parse([
      { name: "lint", enabled: true, source_root: "acme", has_tools: true, has_skills: true },
      { name: "quiet", version: "1.2.0" },
    ]);
    expect(installed.rows.map((p) => p.name)).toEqual(["lint", "quiet"]);
    // Chips follow the display order, not the order of the flags.
    expect(installed.find("lint")?.capabilities).toEqual(["skills", "tools"]);
    expect(installed.find("lint")?.enabled).toBe(true);
    expect(installed.find("quiet")?.enabled).toBe(false);
    expect(installed.find("quiet")?.version).toBe("1.2.0");
    expect(installed.has("missing")).toBe(false);
  });

  it("reads an answer that is not a list as nothing installed", () => {
    // igni-core answers a bare list; the panel no longer unwraps the
    // ``{plugins: [...]}`` shape an old backend sent.
    expect(InstalledPlugins.parse({ plugins: [{ name: "lint" }] }).count).toBe(0);
    expect(InstalledPlugins.parse(null).count).toBe(0);
  });

  it("drops a row with no name to address it by", () => {
    expect(InstalledPlugins.parse([{ description: "orphan" }, "junk", { name: "ok" }]).count).toBe(1);
  });
});

describe("PluginAbout#or", () => {
  it("keeps its own fields and fills the empty ones from the fallback", () => {
    const installed = new PluginAbout("lint", "", "2.0.0");
    const catalog = new PluginAbout("lint-catalog", "Lints things", "1.0.0");
    const merged = installed.or(catalog);
    expect([merged.name, merged.description, merged.version]).toEqual(["lint", "Lints things", "2.0.0"]);
  });

  it("reads a field of the wrong type as empty", () => {
    const about = PluginAbout.read(new WirePayload({ name: "x", description: 7, version: null }));
    expect([about.name, about.description, about.version]).toEqual(["x", "", ""]);
  });
});

describe("PluginContents.parse", () => {
  it("reads every bundled part by name", () => {
    const contents = PluginContents.parse({
      root_path: "/plugins/lint",
      readme: "# Lint",
      skills: [{ name: "fix", description: "Fix lint" }],
      agents: [{ name: "reviewer" }],
      hooks: [{ event: "PreToolUse", count: "2" }],
      mcp_servers: [{ name: "fs", transport: "stdio", command: "npx fs" }],
      tools: [{ name: "lint_file" }],
    });
    expect(contents.rootPath).toBe("/plugins/lint");
    expect(contents.parts.skills).toEqual([{ name: "fix", description: "Fix lint" }]);
    expect(contents.parts.agents).toEqual([{ name: "reviewer", description: "" }]);
    expect(contents.parts.hooks).toEqual([{ event: "PreToolUse", count: 2 }]);
    expect(contents.parts.mcpServers).toEqual([{ name: "fs", transport: "stdio", command: "npx fs" }]);
    expect(contents.isEmpty).toBe(false);
  });

  it("reads missing or malformed lists as empty instead of failing the page", () => {
    const contents = PluginContents.parse({ root_path: "/p", agents: "nope", hooks: null });
    expect(contents.parts.agents).toEqual([]);
    expect(contents.parts.hooks).toEqual([]);
    expect(contents.isEmpty).toBe(true);
  });

  it("is not empty when only a README is bundled", () => {
    expect(PluginContents.parse({ readme: "hello" }).isEmpty).toBe(false);
  });
});

describe("PluginAction", () => {
  it("is the same action for every button acting on one plugin", () => {
    expect(PluginAction.plugin("lint").is(PluginAction.plugin("lint"))).toBe(true);
    expect(PluginAction.plugin("lint").is(PluginAction.plugin("quiet"))).toBe(false);
    expect(PluginAction.removeMarketplace("a").is(PluginAction.removeMarketplace("a"))).toBe(true);
    expect(PluginAction.refresh().is(PluginAction.installRef())).toBe(false);
  });
});
