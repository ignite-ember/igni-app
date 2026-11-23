// @vitest-environment jsdom
/**
 * The MCP servers page: which servers are configured, whether each is
 * connected, what it offers, and which of its tools the agent may see.
 *
 * Pinned: the page connects configured servers before listing them, a
 * failed read says so rather than claiming there are no servers, a
 * policy-blocked server cannot be connected from here, hiding a tool
 * reacts at once and is undone by a re-read when the backend refuses,
 * and a failed connect is reported and leaves the page usable. A
 * project's or a plugin's server waiting for its first-use approval says
 * so, cannot be connected, and is approved (then connected) or has its
 * approval withdrawn from here; the user's own config is not withdrawable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { McpPanel } from "./McpPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const GITHUB = {
  name: "github",
  connected: true,
  transport: "stdio",
  tool_names: ["github__create_issue", "search"],
  tool_descriptions: { github__create_issue: "Open an issue in a repository." },
  tools_disabled: ["search"],
  resources: [
    {
      uri: "repo://acme/web",
      name: "acme/web",
      description: "The web repo",
      mime_type: "text/plain",
    },
    { uri: "repo://acme/bare", name: "", description: "", mime_type: "" },
  ],
  prompts: [
    {
      name: "triage",
      description: "Triage an issue",
      arguments: ["issue", "label"],
    },
    { name: "plain", description: "", arguments: [] },
  ],
};

const DOWN = {
  name: "jira",
  connected: false,
  transport: "sse",
  error: "401 Unauthorized",
};
const BLOCKED = {
  name: "pastebin",
  connected: false,
  transport: "http",
  policy_blocked: true,
};
const BARE = { connected: false };

interface Opts {
  details?: unknown;
  setTool?: () => Promise<unknown>;
  toggle?: () => Promise<unknown>;
  approvals?: unknown;
  setApproval?: (args: unknown) => Promise<unknown>;
}

function panelWith({ details = [GITHUB], setTool, toggle, approvals, setApproval }: Opts = {}) {
  const methods: string[] = [];
  const rpc = vi.fn(async (method: string, args?: unknown) => {
    methods.push(method);
    if (method === "get_mcp_server_details") {
      if (details instanceof Error) throw details;
      return details;
    }
    if (method === "set_mcp_tool_enabled" && setTool) return setTool();
    if (method === "list_mcp_approvals") {
      if (approvals instanceof Error) throw approvals;
      return approvals ?? [];
    }
    if (method === "set_mcp_approval" && setApproval) return setApproval(args);
    void args;
    return null;
  });
  const mcpToggle = vi.fn(toggle ?? (async () => ({ type: "info" })));
  const onAddServer = vi.fn();
  render(
    <McpPanel
      client={{ rpc, mcpToggle } as never}
      onClose={() => {}}
      onAddServer={onAddServer}
    />,
  );
  return { rpc, mcpToggle, onAddServer, methods };
}

describe("the server list", () => {
  it("connects configured servers before asking what they offer", async () => {
    const { methods } = panelWith();
    await screen.findByText(/github/);
    expect(methods.slice(0, 2)).toEqual([
      "ensure_mcp",
      "get_mcp_server_details",
    ]);
  });

  it("says when no server is configured", async () => {
    panelWith({ details: [] });
    expect(await screen.findByText("No MCP servers configured.")).toBeTruthy();
  });

  it("says the list could not be read, rather than that it is empty", async () => {
    panelWith({ details: new Error("backend gone") });
    expect(
      await screen.findByText("Could not read the MCP servers: backend gone"),
    ).toBeTruthy();
    expect(screen.queryByText("No MCP servers configured.")).toBeNull();
  });

  it("reads lists the backend sent malformed as empty", async () => {
    panelWith({
      details: [
        { name: "odd", connected: true, tool_names: "nope", resources: null },
      ],
    });
    expect(await screen.findByText("0 tools — click to expand")).toBeTruthy();
  });

  it("summarises a connected server and explains one that is not", async () => {
    panelWith({ details: [GITHUB, DOWN, BLOCKED, BARE] });
    expect(
      await screen.findByText(
        "2 tools · 2 resources · 2 prompts — click to expand",
      ),
    ).toBeTruthy();
    expect(screen.getByText("401 Unauthorized")).toBeTruthy();
    expect(screen.getByText("blocked by policy")).toBeTruthy();
    expect(screen.getByText("disconnected")).toBeTruthy();
  });

  it("does not let a policy-blocked server be connected", async () => {
    panelWith({ details: [BLOCKED] });
    await screen.findByText("blocked by policy");
    expect(
      (screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("hands the composer a setup prompt rather than a form", async () => {
    const { onAddServer } = panelWith();
    fireEvent.click(screen.getByRole("button", { name: "Add an MCP server" }));
    const [seed] = onAddServer.mock.calls[0];
    expect(seed).toMatch(/Help me set up a new MCP server/);
    expect(seed).toMatch(/mcpServers/);
  });
});

describe("connecting and disconnecting", () => {
  it("disconnects a connected server and re-reads the list", async () => {
    const { mcpToggle, methods } = panelWith();
    await screen.findByText(/click to expand/);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(mcpToggle).toHaveBeenCalledWith("github", false);
    await waitFor(() =>
      expect(
        methods.filter((m) => m === "get_mcp_server_details"),
      ).toHaveLength(2),
    );
  });

  it("shows the button busy while the toggle is in flight", async () => {
    let finish: () => void = () => {};
    panelWith({
      details: [DOWN],
      toggle: () => new Promise((r) => (finish = () => r({ type: "info" }))),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(screen.getByRole("button", { name: "…" })).toBeTruthy();
    finish();
    expect(await screen.findByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("reports a failed connect and stays usable", async () => {
    const { methods } = panelWith({
      details: [DOWN],
      toggle: async () => {
        throw new Error("request timed out");
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(
        methods.filter((m) => m === "get_mcp_server_details"),
      ).toHaveLength(2),
    );
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(
      screen.getByText("Could not connect jira: request timed out"),
    ).toBeTruthy();
  });
});

describe("what a server offers", () => {
  it("expands into tools, resources and prompts", async () => {
    panelWith();
    fireEvent.click(await screen.findByText(/click to expand/));
    // The server prefix Agno adds is split off the tool's name.
    expect(screen.getByText("create_issue")).toBeTruthy();
    expect(screen.getByText("Open an issue in a repository.")).toBeTruthy();
    expect(screen.getByText("off")).toBeTruthy();
    expect(screen.getByText("acme/web")).toBeTruthy();
    expect(screen.getByText("text/plain · repo://acme/web")).toBeTruthy();
    // A resource with no name is named by its uri.
    expect(screen.getAllByText("repo://acme/bare").length).toBeGreaterThan(0);
    expect(screen.getByText("(issue, label)")).toBeTruthy();
    expect(screen.getByText("Triage an issue")).toBeTruthy();
  });

  it("opens from a button that says whether it is open", async () => {
    panelWith();
    await screen.findByText(/click to expand/);
    const head = document.querySelector(
      "button.mcp-server-head",
    ) as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not expand a server with nothing to show", async () => {
    panelWith({ details: [DOWN] });
    fireEvent.click(await screen.findByText("401 Unauthorized"));
    expect(document.querySelector(".mcp-server-body")).toBeNull();
    expect(document.querySelector("button.mcp-server-head")).toBeNull();
  });

  it("hides a tool from the agent at once and tells the backend", async () => {
    const { rpc } = panelWith();
    fireEvent.click(await screen.findByText(/click to expand/));
    const hide = screen.getByTitle("Hide from agent");
    fireEvent.click(hide);
    expect(screen.getAllByText("off")).toHaveLength(2);
    expect(rpc).toHaveBeenCalledWith("set_mcp_tool_enabled", {
      server: "github",
      tool: "github__create_issue",
      enabled: false,
    });
  });

  it("turns a hidden tool back on", async () => {
    const { rpc } = panelWith();
    fireEvent.click(await screen.findByText(/click to expand/));
    fireEvent.click(screen.getByTitle("Enable for agent"));
    expect(screen.queryByText("off")).toBeNull();
    expect(rpc).toHaveBeenCalledWith("set_mcp_tool_enabled", {
      server: "github",
      tool: "search",
      enabled: true,
    });
  });

  it("re-reads the truth when the backend refuses a tool change", async () => {
    const { methods } = panelWith({
      setTool: async () => {
        throw new Error("refused");
      },
    });
    fireEvent.click(await screen.findByText(/click to expand/));
    fireEvent.click(screen.getByTitle("Enable for agent"));
    await waitFor(() =>
      expect(
        methods.filter((m) => m === "get_mcp_server_details"),
      ).toHaveLength(2),
    );
    expect(screen.getByText("Could not change search: refused")).toBeTruthy();
  });

  it("offers Show more only for a description that overflows", async () => {
    // jsdom lays nothing out, so heights are given: taller than shown.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(30);
    panelWith();
    fireEvent.click(await screen.findByText(/click to expand/));
    const [more] = screen.getAllByRole("button", { name: "Show more…" });
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });
});

describe("first-use approvals (R669, R209)", () => {
  const PROJECT_SERVER = { name: "jira", connected: false, transport: "sse", error: "MCP 'jira' is not approved" };
  const waiting = { name: "jira", source: "project", source_path: "/work/repo/.mcp.json", approved: false };
  const approved = { ...waiting, approved: true };

  it("shows a server waiting for approval as refused, with Approve instead of Connect", async () => {
    panelWith({ details: [PROJECT_SERVER], approvals: [waiting] });
    expect(await screen.findByText("waiting for your approval · /work/repo/.mcp.json")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve jira" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("approves a server, connects it and re-reads the list", async () => {
    const setApproval = vi.fn(async () => approved);
    const { mcpToggle, methods } = panelWith({ details: [PROJECT_SERVER], approvals: [waiting], setApproval });
    fireEvent.click(await screen.findByRole("button", { name: "Approve jira" }));
    await waitFor(() => expect(mcpToggle).toHaveBeenCalledWith("jira", true));
    expect(setApproval).toHaveBeenCalledWith({ server_name: "jira", approved: true });
    await waitFor(() => expect(methods.filter((m) => m === "list_mcp_approvals")).toHaveLength(2));
  });

  it("withdraws an approval without connecting anything", async () => {
    const setApproval = vi.fn(async () => waiting);
    const { mcpToggle } = panelWith({
      details: [{ ...PROJECT_SERVER, connected: true, error: "" }],
      approvals: [approved],
      setApproval,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Revoke the approval of jira" }));
    await waitFor(() => expect(setApproval).toHaveBeenCalledWith({ server_name: "jira", approved: false }));
    expect(mcpToggle).not.toHaveBeenCalled();
  });

  it("offers no Revoke for the user's own config, which is always trusted", async () => {
    panelWith({ details: [GITHUB], approvals: [{ name: "github", source: "user", source_path: "~/.igni/.mcp.json", approved: true }] });
    await screen.findByText(/click to expand/);
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });

  it("says why an approval was refused, and keeps the server waiting", async () => {
    panelWith({
      details: [PROJECT_SERVER],
      approvals: [waiting],
      setApproval: async () => {
        throw new Error("only igni's window may call set_mcp_approval");
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Approve jira" }));
    expect(
      await screen.findByText("Could not approve jira: only igni's window may call set_mcp_approval"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve jira" })).toBeTruthy();
  });

  it("lists a configured server waiting for approval that the details left out", async () => {
    panelWith({ details: [], approvals: [waiting] });
    expect(await screen.findByRole("button", { name: "Approve jira" })).toBeTruthy();
    expect(screen.queryByText("No MCP servers configured.")).toBeNull();
  });

  it("works as before against a backend that lists no approvals", async () => {
    panelWith({ details: [DOWN], approvals: new Error("unknown method") });
    expect(await screen.findByRole("button", { name: "Connect" })).toBeTruthy();
  });
});
