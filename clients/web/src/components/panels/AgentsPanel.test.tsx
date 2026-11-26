// @vitest-environment jsdom
/**
 * The Agents page: a card grid you search, narrow by source and sort,
 * each agent's own page one level down, and keep or discard for the
 * agents made during this session.
 *
 * "Keep" used to be the only way to keep one, and it always wrote to
 * `.igni/agents/` — committed, shared with everybody on the project.
 * "Keep for me" writes to `.igni/agents.local/`, which `.igni/.gitignore`
 * keeps out of git.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { PageContext } from "../PageShell";
import { AgentsPanel } from "./AgentsPanel";
import type { AgentRow } from "./agents/agentRecord";

afterEach(cleanup);

const ROWS: AgentRow[] = [
  {
    name: "reviewer",
    description: "Reviews code for bugs",
    can_orchestrate: true,
    tools: ["Read", "Grep", "Ghost"],
    unknown_tools: ["Ghost"],
    tags: ["review"],
    mcp_servers: ["github"],
    model: "opus",
    system_prompt: "# Be strict\nCheck everything.",
    source_path: "/work/proj/.igni/agents/reviewer.md",
  },
  {
    name: "architect",
    description: "Designs features",
    source_path: "/opt/igni/igni_core/bundled_agents/architect.md",
  },
  { name: "migrator", description: "Moves the schema", is_ephemeral: true },
  {
    name: "acme:linter",
    description: "Lints with acme",
    source_path: "/Users/me/.igni/plugins/acme/agents/linter.md",
  },
];

function mount(rows: AgentRow[] | (() => Promise<AgentRow[]>) = ROWS, asPage = false) {
  let current = rows;
  const rpc = vi.fn(async (method: string) => {
    if (method !== "get_agent_details") return { ok: true };
    return typeof current === "function" ? current() : current;
  });
  const panel = <AgentsPanel client={{ rpc } as never} onClose={() => {}} />;
  render(
    asPage ? (
      <PageContext.Provider
        value={{
          trail: [{ kind: "agents", label: "Agents" }] as never,
          onCrumb: () => {},
          onBack: () => {},
          onClose: () => {},
        }}
      >
        {panel}
      </PageContext.Provider>
    ) : (
      panel
    ),
  );
  return {
    rpc,
    setRows: (next: AgentRow[]) => {
      current = next;
    },
  };
}

const cardNames = () =>
  Array.from(document.querySelectorAll(".entity-card[role=button] .entity-card-name")).map((n) => n.textContent);
const foot = (card: Element) =>
  Array.from(card.querySelectorAll(".entity-card-foot > .entity-meta")).map((m) => m.textContent);
const chips = (card: Element) =>
  Array.from(card.querySelectorAll(".entity-card-chips > .hero-chip")).map((m) => m.textContent);

describe("the agents list", () => {
  it("shows a skeleton while the first read is in flight", () => {
    mount(() => new Promise(() => {}));
    expect(document.querySelector(".card-grid .entity-card")).toBeTruthy();
    expect(document.querySelector(".entity-card[role=button]")).toBeNull();
  });

  it("draws one card per agent, by name, the shared card: neutral chips, source in the faint footer", async () => {
    mount();
    await screen.findByText("reviewer");
    expect(cardNames()).toEqual(["acme:linter", "architect", "migrator", "reviewer"]);
    const reviewer = screen.getByRole("button", { name: "reviewer" });
    expect(chips(reviewer)[0]).toBe("orchestrates");
    expect(foot(reviewer)).toEqual(["Project", "opus", "3 tools", "1 MCP server"]);
    expect(reviewer.querySelector(".entity-glyph")?.textContent).toBe("RE");
    const architect = screen.getByRole("button", { name: "architect" });
    expect(foot(architect)).toEqual(["Built-in", "Default model", "All tools"]);
    const linter = screen.getByRole("button", { name: "acme:linter" });
    expect(foot(linter)[0]).toBe("Plugin · acme");
    expect(linter.querySelector(".entity-glyph")?.textContent).toBe("LI");
    expect(foot(screen.getByRole("button", { name: "migrator" }))[0]).toBe("Unsaved");
  });

  it("searches names and descriptions, and says when nothing matches", async () => {
    mount();
    await screen.findByText("reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Search agents" }));
    const box = screen.getByRole("textbox", { name: "Search agents" });
    fireEvent.change(box, { target: { value: "SCHEMA" } });
    expect(cardNames()).toEqual(["migrator"]);
    fireEvent.change(box, { target: { value: "lint" } });
    expect(cardNames()).toEqual(["acme:linter"]);
    fireEvent.change(box, { target: { value: "nothing like this" } });
    expect(screen.getByText("No agents match")).toBeTruthy();
  });

  it("sorts by source and narrows to one source", async () => {
    mount();
    await screen.findByText("reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Source" }));
    expect(cardNames()).toEqual(["migrator", "reviewer", "acme:linter", "architect"]);

    const filter = screen.getByRole("button", { name: "Source" });
    fireEvent.click(filter);
    const options = screen.getAllByRole("menuitemradio").map((o) => o.textContent);
    expect(options).toEqual(["All sources", "Unsaved", "Project", "Plugin", "Built-in"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Built-in" }));
    expect(cardNames()).toEqual(["architect"]);
    expect(filter.className).toContain("is-active");
  });

  it("leaves the filter out when every agent comes from one place", async () => {
    mount([ROWS[0]]);
    await screen.findByText("reviewer");
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sort" })).toBeTruthy();
  });

  it("says there are none, without header controls, when the pool is empty", async () => {
    mount([]);
    expect(await screen.findByText("No agents yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search agents" })).toBeNull();
  });

  it("treats a failed read as an empty pool", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mount(() => Promise.reject(new Error("down")));
    expect(await screen.findByText("No agents yet")).toBeTruthy();
    error.mockRestore();
  });
});

describe("keeping an ephemeral agent", () => {
  it("keeps it for the project, without opening it", async () => {
    const { rpc } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("promote_ephemeral_agent", {
        name: "migrator",
        target: "project",
      }),
    );
    expect(screen.queryByRole("heading", { name: "migrator" })).toBeNull();
  });

  it("keeps it for you only", async () => {
    const { rpc } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Keep for me" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("promote_ephemeral_agent", {
        name: "migrator",
        target: "personal",
      }),
    );
  });

  it("discards it, then reads the pool again", async () => {
    const { rpc, setRows } = mount();
    await screen.findByText("migrator");
    setRows(ROWS.filter((r) => r.name !== "migrator"));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByText("migrator")).toBeNull());
    expect(rpc).toHaveBeenCalledWith("discard_ephemeral_agent", { name: "migrator" });
  });

  it("only saved agents carry no actions", async () => {
    mount();
    await screen.findByText("reviewer");
    expect(screen.getAllByRole("button", { name: "Discard" })).toHaveLength(1);
  });
});

describe("an agent's own page", () => {
  it("opens from a card by click or Enter, with the agent in a hero", async () => {
    mount();
    fireEvent.keyDown(await screen.findByRole("button", { name: "reviewer" }), { key: "Enter" });
    expect(screen.getByRole("heading", { name: "reviewer" })).toBeTruthy();
    const hero = document.querySelector(".entity-hero") as HTMLElement;
    expect(hero.querySelector(".entity-hero-desc")?.textContent).toBe("Reviews code for bugs");
    expect(within(hero).getByText("opus")).toBeTruthy();
    expect(within(hero).getByText("3 tools")).toBeTruthy();
    expect(within(hero).getByText("orchestrates")).toBeTruthy();
    expect(hero.querySelector(".entity-hero-actions")).toBeNull();
    // The list's controls belong to the list.
    expect(screen.queryByRole("button", { name: "Search agents" })).toBeNull();
  });

  it("lays out tools, MCP servers, tags, source and the prompt in their own cards", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "reviewer" }));
    const sections = screen.getAllByRole("region").map((s) => s.getAttribute("aria-label"));
    expect(sections).toEqual(["Tools", "MCP servers", "Tags", "Source", "System prompt"]);
    const tools = screen.getByRole("region", { name: "Tools" });
    expect(within(tools).getByText("Ghost").className).toBe("detail-pill is-flagged");
    expect(within(tools).getByText("Read").className).toBe("detail-pill");
    expect(within(tools).getByText(/can't find Ghost/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Be strict" })).toBeTruthy();
    expect(screen.getByText("/work/proj/.igni/agents/reviewer.md")).toBeTruthy();
  });

  it("draws the shared detail layout: plain hero, sections, facts and one prose style", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "reviewer" }));
    const detail = document.querySelector(".entity-detail") as HTMLElement;
    const hero = detail.querySelector(".entity-hero") as HTMLElement;
    // The name is the plain heading; meta and chips are the hero's own.
    expect(hero.querySelector("h2")?.className).toBe("entity-hero-title");
    expect(hero.querySelector(".entity-hero-meta")?.textContent).toBe("opus3 tools");
    expect(hero.querySelector(".plugins-version")).toBeNull();
    expect([...hero.querySelectorAll(".hero-chip")].map((c) => c.textContent)).toEqual([
      "Project",
      "orchestrates",
    ]);
    // Every part below the hero is a DetailSection.
    for (const region of screen.getAllByRole("region")) {
      expect(region.className).toBe("detail-section");
      expect(region.parentElement).toBe(detail);
    }
    const source = screen.getByRole("region", { name: "Source" });
    const file = within(source).getByText("/work/proj/.igni/agents/reviewer.md");
    expect(file.tagName).toBe("DD");
    expect(file.className).toBe("is-mono");
    const prompt = screen.getByRole("region", { name: "System prompt" });
    expect(prompt.querySelector(".detail-md h1, .detail-md h2, .detail-md h3")).toBeTruthy();
    expect(prompt.querySelector(".agent-prompt-md")).toBeNull();
  });

  it("leaves out the sections an agent has nothing for", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "architect" }));
    expect(screen.getAllByRole("region").map((s) => s.getAttribute("aria-label"))).toEqual([
      "Source",
    ]);
  });

  it("keeps an unsaved agent from its page and shows it as it now is", async () => {
    const { rpc, setRows } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "migrator" }));
    expect(screen.getByRole("heading", { name: "migrator" })).toBeTruthy();
    setRows(
      ROWS.map((r) =>
        r.name === "migrator"
          ? { ...r, is_ephemeral: false, source_path: "/work/proj/.igni/agents/migrator.md" }
          : r,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith("promote_ephemeral_agent", {
      name: "migrator",
      target: "project",
    });
    expect(screen.getByRole("heading", { name: "migrator" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });

  it("drops back to the list once its agent is discarded", async () => {
    const { setRows } = mount();
    fireEvent.click(await screen.findByRole("button", { name: "migrator" }));
    setRows(ROWS.filter((r) => r.name !== "migrator"));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "migrator" })).toBeNull());
    expect(screen.getByRole("button", { name: "reviewer" })).toBeTruthy();
  });

  it("as a page, puts the agent on the trail and goes back from it", async () => {
    mount(ROWS, true);
    fireEvent.click(await screen.findByRole("button", { name: "reviewer" }));
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(trail).getByText("reviewer")).toBeTruthy();
    // The page's own title is not drawn over the hero.
    expect(document.querySelector(".page-title")).toBeNull();
    fireEvent.click(within(trail).getByRole("button", { name: "Agents" }));
    expect(screen.queryByRole("heading", { name: "reviewer" })).toBeNull();
    expect(screen.getByRole("button", { name: "reviewer" })).toBeTruthy();
  });

  it("labels an agent without a name", async () => {
    mount([{ description: "nameless" }], true);
    fireEvent.click(await screen.findByRole("button", { name: "Agent" }));
    expect(screen.getByRole("heading", { name: "Agent" })).toBeTruthy();
  });
});
