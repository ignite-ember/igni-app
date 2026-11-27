// @vitest-environment jsdom
/**
 * The MCP servers page: which servers are configured, whether each is
 * connected, and — on each server's own page, opened from its card —
 * what it offers and which of its tools the agent may see.
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
  within,
} from "@testing-library/react";

import { PageContext } from "../PageShell";
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
  /** Rendered as a page, with a trail, rather than as a dialog. */
  asPage?: boolean;
}

function panelWith({ details = [GITHUB], setTool, toggle, approvals, setApproval, asPage = false }: Opts = {}) {
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
  const panel = (
    <McpPanel client={{ rpc, mcpToggle } as never} onClose={() => {}} onAddServer={onAddServer} />
  );
  const trail = [{ kind: "mcp", label: "MCP Servers" } as never];
  render(
    asPage ? (
      <PageContext.Provider value={{ trail, onCrumb: () => {}, onBack: () => {}, onClose: () => {} }}>
        {panel}
      </PageContext.Provider>
    ) : (
      panel
    ),
  );
  return { rpc, mcpToggle, onAddServer, methods };
}

const names = () => [...document.querySelectorAll(".entity-card-name")].map((n) => n.textContent);

/** A server's card on the list, found by its accessible name. */
async function card(name: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: `Open ${name}` });
}

/** Opens a server's own page from its card. */
async function openServer(name = "github"): Promise<void> {
  fireEvent.click(await card(name));
  await screen.findByRole("heading", { name });
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

  it("reloads the config and the list on demand, without leaving the page", async () => {
    const details: unknown[] = [GITHUB];
    const { methods } = panelWith({ details });
    await screen.findByText(/github/);
    expect(screen.queryByText("jira")).toBeNull();

    // A server is added to .mcp.json while the page is open.
    details.push(DOWN);
    fireEvent.click(screen.getByRole("button", { name: "Reload MCP config" }));

    expect(await screen.findByText("jira")).toBeTruthy();
    // ensure_mcp is what re-reads the files, so the reload asks it again.
    expect(methods.filter((m) => m === "ensure_mcp")).toHaveLength(2);
    expect(methods.filter((m) => m === "get_mcp_server_details")).toHaveLength(2);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Reload MCP config" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("says when no server is configured", async () => {
    panelWith({ details: [] });
    expect(await screen.findByText("No MCP servers configured")).toBeTruthy();
  });

  it("says the list could not be read, rather than that it is empty", async () => {
    panelWith({ details: new Error("backend gone") });
    expect(
      await screen.findByText("Could not read the MCP servers: backend gone"),
    ).toBeTruthy();
    expect(screen.queryByText("No MCP servers configured")).toBeNull();
  });

  it("reads lists the backend sent malformed as empty", async () => {
    panelWith({
      details: [
        { name: "odd", connected: true, tool_names: "nope", resources: null },
      ],
    });
    expect(await screen.findByText("0 tools")).toBeTruthy();
  });

  it("counts what a connected server offers and explains one that is not", async () => {
    panelWith({ details: [GITHUB, DOWN, BLOCKED, BARE] });
    const github = await card("github");
    expect(within(github).getByText("2 tools")).toBeTruthy();
    expect(within(github).getByText("2 prompts")).toBeTruthy();
    expect(within(github).getByText("2 resources")).toBeTruthy();
    expect(within(github).getByText("connected")).toBeTruthy();
    expect(within(github).getByText("stdio")).toBeTruthy();
    // A refused credential reads as what to fix, keeping the status code.
    const jira = await card("jira");
    expect(
      within(jira).getByText(/refused the credentials \(401 Unauthorized\)\. Check its token/),
    ).toBeTruthy();
    expect(within(jira).getByText("failed")).toBeTruthy();
    expect(within(await card("pastebin")).getByText("blocked by policy")).toBeTruthy();
    expect(within(await card("?")).getByText("disconnected")).toBeTruthy();
  });

  it("keeps the transport's own words one hover away", async () => {
    panelWith({ details: [DOWN] });
    const line = await screen.findByText(/refused the credentials/);
    expect(line.getAttribute("title")).toBe("401 Unauthorized");
  });

  it("does not let a policy-blocked server be connected", async () => {
    panelWith({ details: [BLOCKED] });
    await screen.findByText("blocked by policy");
    expect(
      (screen.getByRole("button", { name: "Connect pastebin" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(await card("pastebin"));
    expect(
      (screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("hands the composer a setup prompt rather than a form", async () => {
    const { onAddServer } = panelWith();
    fireEvent.click(screen.getByRole("button", { name: "Add server (MCP)" }));
    const [seed] = onAddServer.mock.calls[0];
    expect(seed).toMatch(/Help me set up a new MCP server/);
    expect(seed).toMatch(/mcpServers/);
  });
});

describe("connecting and disconnecting", () => {
  it("disconnects a connected server and re-reads the list", async () => {
    const { mcpToggle, methods } = panelWith();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect github" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Connect jira" }));
    expect(screen.getByRole("button", { name: "Connect jira" }).getAttribute("aria-busy")).toBe("true");
    finish();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect jira" }).getAttribute("aria-busy")).toBeNull(),
    );
  });

  it("reports a failed connect and stays usable", async () => {
    const { methods } = panelWith({
      details: [DOWN],
      toggle: async () => {
        throw new Error("request timed out");
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Connect jira" }));
    await waitFor(() =>
      expect(
        methods.filter((m) => m === "get_mcp_server_details"),
      ).toHaveLength(2),
    );
    expect(screen.getByRole("button", { name: "Connect jira" })).toBeTruthy();
    expect(
      screen.getByText("Could not connect jira: request timed out"),
    ).toBeTruthy();
  });
});

describe("a server's own page", () => {
  it("opens from the whole card, its name as the heading, the list's controls gone", async () => {
    panelWith();
    await openServer();
    expect(screen.getByRole("heading", { name: "github" })).toBeTruthy();
    expect(screen.getByText("2 tools · 2 resources · 2 prompts")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add server (MCP)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open github" })).toBeNull();
  });

  it("opens from the keyboard too", async () => {
    panelWith();
    fireEvent.keyDown(await card("github"), { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "github" })).toBeTruthy();
  });

  it("does not open when the card's quick action is pressed", async () => {
    const { mcpToggle } = panelWith();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect github" }));
    expect(mcpToggle).toHaveBeenCalledWith("github", false);
    expect(screen.queryByRole("heading", { name: "github" })).toBeNull();
  });

  it("does not repeat the page's own server as a tool's prefix", async () => {
    panelWith();
    await openServer();
    // `github__create_issue` on the github page shows as `create_issue`
    // with no `github` tag beside it.
    expect(screen.getByText("create_issue")).toBeTruthy();
    expect(document.querySelector(".mcp-tool-prefix")).toBeNull();
  });

  it("lists tools, prompts and resources in their own sections, with counts", async () => {
    panelWith();
    await openServer();
    const tools = screen.getByRole("region", { name: "Tools" });
    expect(within(tools).getByText("create_issue")).toBeTruthy();
    expect(within(tools).getByText("Open an issue in a repository.")).toBeTruthy();
    expect(within(tools).getByText("off")).toBeTruthy();
    expect(within(tools).getByText("1 hidden from the agent — switch one on to let the agent use it.")).toBeTruthy();
    expect(tools.querySelector(".detail-section-count")?.textContent).toBe("2");
    const resources = screen.getByRole("region", { name: "Resources" });
    expect(within(resources).getByText("acme/web")).toBeTruthy();
    expect(within(resources).getByText("text/plain · repo://acme/web")).toBeTruthy();
    // A resource with no name is named by its uri.
    expect(within(resources).getAllByText("repo://acme/bare").length).toBeGreaterThan(0);
    const prompts = screen.getByRole("region", { name: "Prompts" });
    expect(within(prompts).getByText("(issue, label)")).toBeTruthy();
    expect(within(prompts).getByText("Triage an issue")).toBeTruthy();
  });

  it("says why a server that is not connected lists no tools, and leaves out empty sections", async () => {
    panelWith({ details: [DOWN] });
    await openServer("jira");
    expect(screen.getByText("Its tools are listed once the server is connected.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Prompts" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Resources" })).toBeNull();
  });

  it("says when a connected server offers no tools", async () => {
    panelWith({ details: [{ name: "quiet", connected: true, transport: "stdio" }] });
    await openServer("quiet");
    expect(screen.getByText("This server offers no tools.")).toBeTruthy();
  });

  it("shows a failed server's last error, as a sentence and as it came, and offers Reconnect", async () => {
    const { mcpToggle } = panelWith({ details: [DOWN] });
    await openServer("jira");
    expect(screen.getByText(/refused the credentials/)).toBeTruthy();
    const error = screen.getByRole("region", { name: "Last error" });
    expect(error.querySelector(".mcp-detail-error")?.textContent).toBe("401 Unauthorized");
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(mcpToggle).toHaveBeenCalledWith("jira", true);
  });

  it("connects a server that is simply off from its page", async () => {
    const { mcpToggle } = panelWith({ details: [{ name: "idle", connected: false, transport: "stdio" }] });
    await openServer("idle");
    expect(screen.queryByRole("region", { name: "Last error" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(mcpToggle).toHaveBeenCalledWith("idle", true);
  });

  it("disconnects from its page and keeps showing it with its fresh state", async () => {
    const details: Record<string, unknown>[] = [{ ...GITHUB }];
    const { mcpToggle } = panelWith({
      details,
      toggle: async () => {
        details[0] = { ...GITHUB, connected: false, tool_names: [], resources: [], prompts: [] };
        return { type: "info" };
      },
    });
    await openServer();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(mcpToggle).toHaveBeenCalledWith("github", false);
    expect(await screen.findByText("Its tools are listed once the server is connected.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "github" })).toBeTruthy();
  });

  it("returns to the list when its server is gone after a re-read", async () => {
    const details: unknown[] = [GITHUB];
    panelWith({
      details,
      toggle: async () => {
        details.length = 0;
        return { type: "info" };
      },
    });
    await openServer();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(await screen.findByText("No MCP servers configured")).toBeTruthy();
  });

  it("names where the server is configured, never more than the approval tells", async () => {
    panelWith({
      details: [GITHUB],
      approvals: [{ name: "github", source: "project", source_path: "/work/repo/.mcp.json", approved: true }],
    });
    await openServer();
    const config = screen.getByRole("region", { name: "Configuration" });
    expect(within(config).getByText("Scope")).toBeTruthy();
    expect(within(config).getByText("/work/repo/.mcp.json")).toBeTruthy();
    expect(within(config).getByText("approved")).toBeTruthy();
  });

  it("calls the user's own config trusted", async () => {
    panelWith({
      details: [GITHUB],
      approvals: [{ name: "github", source: "user", source_path: "~/.igni/.mcp.json", approved: true }],
    });
    await openServer();
    expect(screen.getByText("trusted (your own config)")).toBeTruthy();
  });

  it("goes back to the list as it was left: search, filter and scroll", async () => {
    panelWith({ details: [GITHUB, DOWN, BLOCKED], asPage: true });
    await screen.findByText("jira");
    fireEvent.click(screen.getByRole("button", { name: "Search MCP servers" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search MCP servers" }), {
      target: { value: "i" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Disconnected" }));
    expect(names()).toEqual(["jira", "pastebin"]);
    const scroller = document.querySelector(".page-body") as HTMLElement;
    scroller.scrollTop = 240;
    fireEvent.click(await card("jira"));
    expect(scroller.scrollTop).toBe(0);
    expect(screen.getByRole("heading", { name: "jira" })).toBeTruthy();
    // The trail names the server; its parent crumb goes back.
    expect(screen.getAllByText("jira").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "MCP Servers" }));
    expect(screen.queryByRole("heading", { name: "jira" })).toBeNull();
    expect(names()).toEqual(["jira", "pastebin"]);
    expect((screen.getByRole("textbox", { name: "Search MCP servers" }) as HTMLInputElement).value).toBe("i");
    expect(screen.getByRole("button", { name: "Filter" }).className).toContain("is-active");
    expect(scroller.scrollTop).toBe(240);
  });

  it("hides a tool from the agent at once and tells the backend", async () => {
    const { rpc } = panelWith();
    await openServer();
    fireEvent.click(screen.getByTitle("Hide from agent"));
    expect(screen.getAllByText("off")).toHaveLength(2);
    expect(rpc).toHaveBeenCalledWith("set_mcp_tool_enabled", {
      server: "github",
      tool: "github__create_issue",
      enabled: false,
    });
  });

  it("turns a hidden tool back on", async () => {
    const { rpc } = panelWith();
    await openServer();
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
    await openServer();
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
    await openServer();
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
    expect(screen.queryByRole("button", { name: "Connect jira" })).toBeNull();
    expect(within(await card("jira")).getByText("needs approval")).toBeTruthy();
    expect(within(await card("jira")).getByText("project")).toBeTruthy();
  });

  it("approves from the server's own page, where its config file is named", async () => {
    const setApproval = vi.fn(async () => approved);
    const { mcpToggle } = panelWith({ details: [PROJECT_SERVER], approvals: [waiting], setApproval });
    await openServer("jira");
    // Waiting is not a failure: no last-error section, no Connect.
    expect(screen.queryByRole("region", { name: "Last error" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.getByText("waiting for your approval · /work/repo/.mcp.json")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve jira" }));
    await waitFor(() => expect(mcpToggle).toHaveBeenCalledWith("jira", true));
    expect(setApproval).toHaveBeenCalledWith({ server_name: "jira", approved: true });
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
    await openServer("jira");
    fireEvent.click(screen.getByRole("button", { name: "Revoke the approval of jira" }));
    await waitFor(() => expect(setApproval).toHaveBeenCalledWith({ server_name: "jira", approved: false }));
    expect(mcpToggle).not.toHaveBeenCalled();
  });

  it("offers no Revoke for the user's own config, which is always trusted", async () => {
    panelWith({ details: [GITHUB], approvals: [{ name: "github", source: "user", source_path: "~/.igni/.mcp.json", approved: true }] });
    await openServer();
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
    expect(screen.queryByText("No MCP servers configured")).toBeNull();
  });

  it("works as before against a backend that lists no approvals", async () => {
    panelWith({ details: [DOWN], approvals: new Error("unknown method") });
    expect(await screen.findByRole("button", { name: "Connect jira" })).toBeTruthy();
  });
});
