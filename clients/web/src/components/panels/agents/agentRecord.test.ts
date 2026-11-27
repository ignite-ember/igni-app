import { describe, expect, it } from "vitest";

import { agentPlugin, agentShortName, agentSource, toolsSummary } from "./agentRecord";

describe("where an agent comes from", () => {
  it.each([
    [{ name: "x", is_ephemeral: true, source_path: "/p/.igni/agents/x.md" }, "session"],
    [{ name: "acme:x", source_path: "/p/.igni/agents/x.md" }, "plugin"],
    [{ name: "x" }, "builtin"],
    [{ name: "x", source_path: "/site/igni_core/bundled_agents/x.md" }, "builtin"],
    [{ name: "x", source_path: "/p/.igni/agents.local/x.md" }, "personal"],
    [{ name: "x", source_path: "/Users/me/.igni/agents/x.md" }, "user"],
    [{ name: "x", source_path: "/home/me/.claude/agents/x.md" }, "user"],
    [{ name: "x", source_path: "/root/.igni/agents/x.md" }, "user"],
    [{ name: "x", source_path: "C:\\Users\\me\\.igni\\agents\\x.md" }, "user"],
    [{ name: "x", source_path: "/Users/me/work/p/.igni/agents/x.md" }, "project"],
    [{ name: "x", source_path: "/srv/p/.claude/agents/x.md" }, "project"],
  ])("%o is %s", (row, source) => {
    expect(agentSource(row)).toBe(source);
  });

  it("splits a plugin agent's name", () => {
    expect(agentPlugin({ name: "acme:lint" })).toBe("acme");
    expect(agentShortName({ name: "acme:lint" })).toBe("lint");
    expect(agentPlugin({ name: "lint" })).toBe("");
    expect(agentShortName({})).toBe("");
    expect(agentPlugin({})).toBe("");
  });

  it("counts tools, or says all when unrestricted", () => {
    expect(toolsSummary({})).toBe("All tools");
    expect(toolsSummary({ tools: ["a"] })).toBe("1 tool");
    expect(toolsSummary({ tools: ["a", "b"] })).toBe("2 tools");
  });
});
