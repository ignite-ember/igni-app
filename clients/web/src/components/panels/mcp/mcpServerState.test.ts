/**
 * A server's status as its card and page show it.
 *
 * Pinned: waiting for approval wins over a stale error, policy is told
 * apart from a failure, the dot tells a failure (red) from a server that
 * is simply off (a quiet ring), and the page's main action follows.
 */
import { describe, expect, it } from "vitest";

import { McpApproval } from "./mcpApproval";
import { McpServer } from "./mcpServer";
import { McpServerState } from "./mcpServerState";

const server = (over: Record<string, unknown>) => McpServer.parse({ name: "x", ...over });
const approval = (approved: boolean, source = "project") =>
  new McpApproval("x", source, "/repo/.mcp.json", approved);

describe("McpServerState", () => {
  it.each([
    [{ connected: true }, undefined, "connected", "connected", "done", "disconnect"],
    [{ connected: false, error: "not approved" }, approval(false), "waiting", "needs approval", "running mcp-waiting", "approve"],
    [{ connected: false, policy_blocked: true }, undefined, "blocked", "blocked by policy", "error", null],
    [{ connected: false, error: "boom" }, undefined, "failed", "failed", "error", "reconnect"],
    [{ connected: false }, undefined, "disconnected", "disconnected", "mcp-idle", "connect"],
  ] as const)("reads %o as %s", (raw, appr, kind, label, dot, action) => {
    const s = new McpServerState(server(raw), appr);
    expect(s.kind).toBe(kind);
    expect(s.label).toBe(label);
    expect(s.dot).toBe(dot);
    expect(s.primaryAction).toBe(action);
    expect(s.waiting).toBe(kind === "waiting");
  });

  it("says whose approval a waiting server needs", () => {
    expect(new McpServerState(server({}), approval(false)).sentence).toBe(
      "waiting for your approval · /repo/.mcp.json",
    );
  });

  it("explains a failure plainly, and policy as policy", () => {
    expect(new McpServerState(server({ error: "Read timed out" }), undefined).sentence).toMatch(
      /^The server didn't answer in time/,
    );
    expect(new McpServerState(server({ policy_blocked: true }), undefined).sentence).toMatch(/policy/);
  });

  it("has nothing to say about a server that is up or simply off", () => {
    expect(new McpServerState(server({ connected: true }), undefined).sentence).toBe("");
    expect(new McpServerState(server({}), undefined).sentence).toBe("");
  });

  it("names its source from the approval, and only then", () => {
    const s = new McpServerState(server({}), approval(true));
    expect(s.source).toBe("project");
    expect(s.sourcePath).toBe("/repo/.mcp.json");
    expect(s.revocable).toBe(true);
    const bare = new McpServerState(server({}), undefined);
    expect(bare.source).toBe("");
    expect(bare.sourcePath).toBe("");
    expect(bare.revocable).toBe(false);
    expect(new McpServerState(server({}), approval(true, "user")).revocable).toBe(false);
  });
});
