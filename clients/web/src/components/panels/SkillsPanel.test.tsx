// @vitest-environment jsdom
/**
 * The Skills page: a card per skill that opens the skill's own page,
 * a play button that runs it, search, a source filter and a sort.
 *
 * Pinned: a card opens the skill and never touches the composer; the
 * play button runs once without opening it; running closes the page and
 * seeds `/name`; back lands on the list as it was left; the source
 * comes from where the skill was loaded.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PageContext } from "../PageShell";
import { SkillsPanel } from "./SkillsPanel";
import { sourceFilters, sourceOf, visibleSkills, type SkillRow } from "./skills/skillsView";

afterEach(cleanup);

const SKILLS: SkillRow[] = [
  {
    name: "pr",
    description: "Open a pull request",
    category: "operations",
    argument_hint: "base-branch",
    source_dir: "/Users/me/code/app/.igni/skills",
    version: "1.2.0",
    body: "# Open a PR\n\nPush the branch, then **open** it.\n\n<script>alert(1)</script>",
  },
  {
    name: "commit",
    description: "Write a commit",
    category: "development",
    source_dir: "/Users/me/.igni/skills/commit",
  },
  {
    name: "acme:deploy",
    description: "Ship it",
    category: "operations",
    context: "fork",
    agent: "ops",
    source_dir: "/Users/me/.igni/plugins/acme/skills",
  },
];

function mount(answer: unknown, { asPage = false } = {}) {
  const rpc = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const onRun = vi.fn();
  const onClose = vi.fn();
  const panel = <SkillsPanel client={{ rpc } as never} onRun={onRun} onClose={onClose} />;
  const trail = [{ kind: "skills", label: "Skills" } as never];
  render(
    asPage ? (
      <PageContext.Provider value={{ trail, onCrumb: () => {}, onBack: () => {}, onClose: () => {} }}>
        {panel}
      </PageContext.Provider>
    ) : (
      panel
    ),
  );
  return { rpc, onRun, onClose };
}

const names = () => [...document.querySelectorAll(".skill-card-name")].map((n) => n.textContent);

describe("the skills page", () => {
  it("shows placeholder cards while the first read is in flight", () => {
    const rpc = vi.fn(() => new Promise(() => {}));
    const { container } = render(<SkillsPanel client={{ rpc } as never} onRun={() => {}} onClose={() => {}} />);
    expect(container.querySelectorAll(".card-grid > .entity-card").length).toBeGreaterThan(0);
    expect(rpc).toHaveBeenCalledWith("get_skill_details");
  });

  it("says how to add one when there are none, or the call fails", async () => {
    mount([]);
    expect(await screen.findByText("No skills installed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search skills" })).toBeNull();
    cleanup();
    mount(new Error("nope"));
    expect(await screen.findByText("No skills installed")).toBeTruthy();
    cleanup();
    mount({ not: "a list" });
    expect(await screen.findByText("No skills installed")).toBeTruthy();
  });

  it("draws each skill as a card, by name, with its source, category and arguments", async () => {
    mount(SKILLS);
    await screen.findByText("/pr");
    expect(names()).toEqual(["/acme:deploy", "/commit", "/pr"]);
    const pr = screen.getByRole("button", { name: "Open /pr" });
    expect(pr.querySelector(".entity-card-desc")?.textContent).toBe("Open a pull request");
    expect(pr.querySelector(".skill-source")?.textContent).toBe("project");
    expect(pr.querySelector(".skill-args")?.textContent).toBe("base-branch");
    expect(pr.querySelector(".entity-glyph")?.textContent).toBe("PR");
    const deploy = screen.getByRole("button", { name: "Open /acme:deploy" });
    expect(deploy.querySelector(".skill-source")?.textContent).toBe("plugin");
    expect(deploy.textContent).toContain("runs on ops");
    expect(deploy.querySelector(".entity-glyph")?.textContent).toBe("DE");
  });

  it("opens the skill's page from the card, by click, Enter or Space, without touching the composer", async () => {
    const { onRun, onClose } = mount(SKILLS);
    await screen.findByText("/pr");
    fireEvent.click(screen.getByText("/pr"));
    expect(screen.getByRole("heading", { name: "/pr" })).toBeTruthy();
    expect(onRun).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    cleanup();
    mount(SKILLS);
    await screen.findByText("/pr");
    fireEvent.keyDown(screen.getByRole("button", { name: "Open /commit" }), { key: "Enter" });
    expect(screen.getByRole("heading", { name: "/commit" })).toBeTruthy();
    cleanup();
    mount(SKILLS);
    await screen.findByText("/pr");
    fireEvent.keyDown(screen.getByRole("button", { name: "Open /commit" }), { key: " " });
    expect(screen.getByRole("heading", { name: "/commit" })).toBeTruthy();
  });

  it("draws the skill's page: hero, its instructions as markdown, and where it lives", async () => {
    const { onRun, onClose } = mount(SKILLS);
    await screen.findByText("/pr");
    fireEvent.click(screen.getByRole("button", { name: "Open /pr" }));
    const detail = document.querySelector(".entity-detail")!;
    const hero = detail.querySelector(".entity-hero")!;
    // The command is the plain heading — no accent, no mono class of its own.
    expect(hero.querySelector("h2")?.className).toBe("entity-hero-title");
    expect(hero.querySelector(".entity-hero-meta")?.textContent).toBe("operationsv1.2.0");
    // Chips are the hero's neutral ones, in one font: no coloured source, no code.
    expect([...hero.querySelectorAll(".entity-hero-chips > .hero-chip")].map((c) => c.textContent)).toEqual([
      "project",
      "takes base-branch",
    ]);
    expect(hero.querySelector(".skill-source, .entity-hero-chips code")).toBeNull();
    expect(hero.textContent).toContain("Open a pull request");
    expect(hero.querySelectorAll(".entity-hero-actions .btn-primary")).toHaveLength(1);
    // Instructions and source are sections straight under the hero.
    const regions = screen.getAllByRole("region");
    expect(regions.map((r) => r.getAttribute("aria-label"))).toEqual(["Instructions", "Source"]);
    for (const r of regions) {
      expect(r.className).toBe("detail-section");
      expect(r.parentElement).toBe(detail);
    }
    const folder = regions[1].querySelector("dd")!;
    expect(folder.className).toBe("is-mono");
    expect(regions[1].querySelector("dt")?.textContent).toBe("Folder");
    const body = regions[0].querySelector(".detail-md")!;
    expect(body.querySelector("h1")?.textContent).toBe("Open a PR");
    expect(body.querySelector("strong")?.textContent).toBe("open");
    // Raw HTML in a skill stays text.
    expect(body.querySelector("script")).toBeNull();
    expect(screen.getByText("/Users/me/code/app/.igni/skills")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search skills" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run /pr" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith("/pr");
  });

  it("says plainly when a skill's instructions were not sent", async () => {
    mount([...SKILLS, { name: "bare" }]);
    await screen.findByText("/pr");
    fireEvent.click(screen.getByRole("button", { name: "Open /acme:deploy" }));
    expect(screen.getByText("runs on ops")).toBeTruthy();
    expect(screen.getByText(/did not send this skill's instructions, so they can only be read in its folder/)).toBeTruthy();
    cleanup();
    mount([{ name: "bare" }]);
    await screen.findByText("/bare");
    fireEvent.click(screen.getByRole("button", { name: "Open /bare" }));
    expect(screen.getByText("igni did not send this skill's instructions.")).toBeTruthy();
  });

  it("goes back to the list as it was left: search, filter and scroll", async () => {
    mount(SKILLS, { asPage: true });
    await screen.findByText("/pr");
    fireEvent.click(screen.getByRole("button", { name: "Search skills" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), {
      target: { value: "operations" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Project" }));
    const scroller = document.querySelector(".page-body") as HTMLElement;
    scroller.scrollTop = 240;
    fireEvent.click(screen.getByRole("button", { name: "Open /pr" }));
    expect(scroller.scrollTop).toBe(0);
    // The trail names the skill; its parent crumb goes back.
    expect(screen.getAllByText("/pr").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(screen.queryByRole("heading", { name: "/pr" })).toBeNull();
    expect(names()).toEqual(["/pr"]);
    expect((screen.getByRole("textbox", { name: "Search skills" }) as HTMLInputElement).value).toBe("operations");
    expect(screen.getByRole("button", { name: "Source" }).className).toContain("is-active");
    expect(scroller.scrollTop).toBe(240);
  });

  it("runs once from the play button, without also opening the card", async () => {
    const { onRun, onClose } = mount(SKILLS);
    await screen.findByText("/commit");
    fireEvent.click(screen.getByRole("button", { name: "Run /commit" }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith("/commit");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "/commit" })).toBeNull();
  });

  it("searches names, descriptions and categories, and clears a search with no hits", async () => {
    mount(SKILLS);
    await screen.findByText("/pr");
    fireEvent.click(screen.getByRole("button", { name: "Search skills" }));
    const box = screen.getByRole("textbox", { name: "Search skills" });
    expect(box.getAttribute("placeholder")).toBe("Search 3 skills…");
    fireEvent.change(box, { target: { value: "ship" } });
    expect(names()).toEqual(["/acme:deploy"]);
    fireEvent.change(box, { target: { value: "operations" } });
    expect(names()).toEqual(["/acme:deploy", "/pr"]);
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText("No skills match")).toBeTruthy();
    expect(screen.getByText("Nothing named or described like “zzz”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all skills" }));
    expect(names()).toHaveLength(3);
  });

  it("filters by source and sorts by source or category", async () => {
    mount(SKILLS);
    await screen.findByText("/pr");
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.getAllByRole("menuitemradio").map((o) => o.textContent)).toEqual([
      "All sources",
      "Project",
      "User",
      "Plugin",
    ]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "User" }));
    expect(names()).toEqual(["/commit"]);
    expect(screen.getByRole("button", { name: "Source" }).className).toContain("is-active");

    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All sources" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Source" }));
    expect(names()).toEqual(["/pr", "/commit", "/acme:deploy"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Category" }));
    expect(names()).toEqual(["/commit", "/acme:deploy", "/pr"]);
  });

  it("reloads from the refresh button", async () => {
    const { rpc } = mount(SKILLS);
    await screen.findByText("/pr");
    fireEvent.click(screen.getByRole("button", { name: "Reload skills" }));
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("skillsView", () => {
  it("knows a skill's source from its name and where it was loaded", () => {
    expect(sourceOf({ name: "a:b", source_dir: "/Users/me/.igni/skills" })).toBe("plugin");
    expect(sourceOf({ name: "x" })).toBe("builtin");
    expect(sourceOf({ name: "x", source_dir: "/opt/igni/core/bundled_skills" })).toBe("builtin");
    expect(sourceOf({ name: "x", source_dir: "/home/me/.claude/skills/x" })).toBe("user");
    expect(sourceOf({ name: "x", source_dir: "/root/.igni/skills" })).toBe("user");
    expect(sourceOf({ name: "x", source_dir: "C:\\Users\\me\\.igni\\skills\\x" })).toBe("user");
    expect(sourceOf({ name: "x", source_dir: "/Users/me/app/.igni/skills" })).toBe("project");
    expect(sourceOf({ source_dir: "/srv/app/.claude/skills" })).toBe("project");
  });

  it("offers only the sources present, and tolerates missing fields", () => {
    expect(sourceFilters([{ name: "x" }]).map((o) => o.label)).toEqual(["All sources", "Built-in"]);
    const rows: SkillRow[] = [{}, { name: "b", description: "B" }];
    expect(visibleSkills(rows, "", "all", "name").map((r) => r.name)).toEqual([undefined, "b"]);
    expect(visibleSkills(rows, "b", "all", "category").map((r) => r.name)).toEqual(["b"]);
    expect(visibleSkills(rows, "", "builtin", "source")).toHaveLength(2);
  });
});
