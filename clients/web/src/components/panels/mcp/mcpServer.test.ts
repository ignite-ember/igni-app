/**
 * How an MCP server's tool names and connection errors are read.
 *
 * Pinned: the transport's common failures become a sentence that says
 * what to check, and an unrecognised one is shown as it came rather than
 * guessed at.
 */
import { describe, expect, it } from "vitest";

import { friendlyError, McpToolName } from "./mcpServer";

describe("McpToolName", () => {
  it("splits the registry's mcp_<server>_ prefix using the server name", () => {
    expect(McpToolName.of("mcp_github_list_issues", "github")).toEqual(
      new McpToolName("list_issues", "github"),
    );
  });

  it("splits a server name that itself contains underscores", () => {
    expect(McpToolName.of("mcp_my_db_run_query", "my_db")).toEqual(
      new McpToolName("run_query", "my_db"),
    );
  });

  it("still splits the older <server>__<tool> spelling", () => {
    expect(McpToolName.of("filesystem__read_file")).toEqual(
      new McpToolName("read_file", "filesystem"),
    );
  });

  it("leaves a name alone when the prefix is another server's", () => {
    expect(McpToolName.of("mcp_github_list_issues", "linear")).toEqual(
      new McpToolName("mcp_github_list_issues"),
    );
  });

  it("does not split the prefix alone into an empty tool", () => {
    expect(McpToolName.of("mcp_github_", "github")).toEqual(new McpToolName("mcp_github_"));
  });
});

describe("friendlyError", () => {
  it("names the command that could not be found", () => {
    expect(friendlyError("[Errno 2] No such file or directory: 'mcp-server-github'")).toBe(
      "Couldn't start “mcp-server-github”: command not found. Install it, or fix the command in .mcp.json.",
    );
  });

  it.each([
    "Client failed to connect: All connection attempts failed",
    "[Errno 61] Connection refused",
    "httpx.ConnectError: boom",
    "Name or service not known",
  ])("says nothing answered for %s", (raw) => {
    expect(friendlyError(raw)).toMatch(/^Couldn't reach the server/);
  });

  it.each(["Read timed out", "TimeoutError", "request timeout"])("says it timed out for %s", (raw) => {
    expect(friendlyError(raw)).toMatch(/^The server didn't answer in time/);
  });

  it.each(["401 Unauthorized", "HTTP 403 Forbidden"])("keeps the status code for %s", (raw) => {
    expect(friendlyError(raw)).toBe(
      `The server refused the credentials (${raw}). Check its token in .mcp.json.`,
    );
  });

  it("shows an unrecognised error as it came", () => {
    expect(friendlyError("MCP 'jira' is not approved")).toBe("MCP 'jira' is not approved");
  });
});
