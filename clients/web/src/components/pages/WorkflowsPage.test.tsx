// @vitest-environment jsdom
/**
 * The Workflows page: a card per workflow, its own page one level
 * down, and the header's search, source filter and sort.
 *
 * Pinned: the play button seeds `/workflows <name>` without opening
 * the card; a card opens the workflow's page, whose Run seeds the same
 * and whose crumb goes back; a failed read says why and can be retried.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PageContext } from "../PageShell";
import { WorkflowsPage } from "./WorkflowsPage";
import { phaseCount, visibleWorkflows, workflowSource, type WorkflowMeta } from "./workflows/workflowsView";

afterEach(cleanup);

const WORKFLOWS: WorkflowMeta[] = [
  {
    name: "triage",
    description: "Label new issues",
    whenToUse: "Monday mornings",
    phases: [
      { title: "Fetch" },
      { title: "Reproduce", detail: "One agent per report", model: "fast" },
      { title: "Label" },
      { title: "Assign" },
      {},
    ],
    path: ".igni/workflows/triage.mjs",
  },
  {
    name: "audit",
    whenToUse: "Before a release",
    phases: [{ title: "Scan" }],
    path: "/Users/me/.igni/workflows/audit.mjs",
  },
];

function mount(answer: unknown, { asPage = false } = {}) {
  const rpc = vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const onRun = vi.fn();
  const page = (
    <WorkflowsPage client={{ rpc } as never} onRun={onRun} onClose={() => {}} />
  );
  render(
    asPage ? (
      <PageContext.Provider
        value={{ trail: [{ kind: "workflows", label: "Workflows" } as never], onCrumb: () => {}, onBack: () => {}, onClose: () => {} }}
      >
        {page}
      </PageContext.Provider>
    ) : (
      page
    ),
  );
  return { rpc, onRun };
}

const names = () => [...document.querySelectorAll(".entity-card-name")].map((n) => n.textContent);
const foot = (card: Element) => [...card.querySelectorAll(".entity-card-foot > .entity-meta")].map((m) => m.textContent);

describe("the workflows page", () => {
  it("shows placeholder cards while reading", () => {
    const rpc = vi.fn(() => new Promise(() => {}));
    const { container } = render(<WorkflowsPage client={{ rpc } as never} onRun={() => {}} onClose={() => {}} />);
    expect(container.querySelectorAll(".card-grid > .entity-card")).toHaveLength(4);
    expect(rpc).toHaveBeenCalledWith("list_workflows");
  });

  it("says where to put one when there are none", async () => {
    mount([]);
    expect(await screen.findByText("No workflows yet")).toBeTruthy();
    cleanup();
    mount(null);
    expect(await screen.findByText("No workflows yet")).toBeTruthy();
  });

  it("says why the read failed, and reads again from refresh", async () => {
    const { rpc } = mount(new Error("boom"));
    expect(await screen.findByText("Could not list workflows: Error: boom")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload workflows" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  });

  it("draws a card per workflow with its phases, source and count", async () => {
    mount(WORKFLOWS);
    await screen.findByText("triage");
    expect(names()).toEqual(["audit", "triage"]);
    const triage = screen.getByRole("button", { name: "Open triage" });
    expect(triage.querySelector(".entity-card-desc")?.textContent).toBe("Label new issues");
    // The card's one look: phases as neutral chips, source and count in the faint footer.
    expect([...triage.querySelectorAll(".entity-card-chips > .hero-chip")].map((p) => p.textContent)).toEqual([
      "Fetch",
      "Reproduce",
      "Label",
      "Assign",
      "+1 more",
    ]);
    expect(foot(triage)).toEqual(["project", "5 phases"]);
    expect(triage.querySelector(".entity-card-name code")).toBeNull();
    const audit = screen.getByRole("button", { name: "Open audit" });
    // No description: when to use stands in.
    expect(audit.querySelector(".entity-card-desc")?.textContent).toBe("Before a release");
    expect(foot(audit)).toEqual(["user", "1 phase"]);
  });

  it("seeds the run from the play button without opening the card", async () => {
    const { onRun } = mount(WORKFLOWS);
    await screen.findByText("triage");
    fireEvent.click(screen.getByRole("button", { name: "Run triage" }));
    expect(onRun).toHaveBeenCalledWith("/workflows triage");
    expect(screen.queryByRole("heading", { name: "triage" })).toBeNull();
  });

  it("opens a workflow's page with every phase, runs from it and goes back", async () => {
    const { onRun } = mount(WORKFLOWS, { asPage: true });
    await screen.findByText("triage");
    fireEvent.click(screen.getByRole("button", { name: "Open triage" }));
    expect(screen.getByRole("heading", { name: "triage" })).toBeTruthy();
    expect(screen.getByText("Monday mornings")).toBeTruthy();
    expect(screen.getByText("One agent per report")).toBeTruthy();
    expect(screen.getByText("fast")).toBeTruthy();
    expect(screen.getByText("Phase 5")).toBeTruthy();
    expect(screen.getByText(".igni/workflows/triage.mjs")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Search workflows" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Run/ }));
    expect(onRun).toHaveBeenCalledWith("/workflows triage");
    fireEvent.click(screen.getByRole("button", { name: "Workflows" }));
    expect(screen.queryByRole("heading", { name: "triage" })).toBeNull();
    expect(names()).toEqual(["audit", "triage"]);
  });

  it("draws a workflow's page in the shared detail layout", async () => {
    mount(WORKFLOWS);
    await screen.findByText("triage");
    fireEvent.click(screen.getByRole("button", { name: "Open triage" }));
    const detail = document.querySelector(".entity-detail")!;
    const hero = detail.querySelector(".entity-hero")!;
    expect(hero.querySelector("h2")?.className).toBe("entity-hero-title");
    expect(hero.querySelector(".entity-hero-meta")?.textContent).toBe("5 phases");
    expect([...hero.querySelectorAll(".entity-hero-chips > .hero-chip")].map((c) => c.textContent)).toEqual([
      "project",
    ]);
    expect(hero.querySelector(".workflow-source")).toBeNull();
    expect(hero.querySelectorAll(".entity-hero-actions .button--primary")).toHaveLength(1);
    const regions = screen.getAllByRole("region");
    expect(regions.map((r) => r.getAttribute("aria-label"))).toEqual(["When to use", "Phases", "Source"]);
    for (const r of regions) {
      expect(r.className).toBe("detail-section");
      expect(r.parentElement).toBe(detail);
    }
    expect(regions[1].querySelector(".detail-section-count")?.textContent).toBe("5");
    expect(regions[1].querySelectorAll(".workflow-step")).toHaveLength(5);
    const file = regions[2].querySelector("dd")!;
    expect(file.textContent).toBe(".igni/workflows/triage.mjs");
    expect(file.className).toBe("is-mono");
  });

  it("leaves out every section a bare workflow lacks", async () => {
    mount([{ name: "bare" }]);
    await screen.findByText("bare");
    fireEvent.click(screen.getByRole("button", { name: "Open bare" }));
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  it("opens by keyboard too, and a bare workflow's page leaves out what it lacks", async () => {
    mount([{ name: "bare" }]);
    await screen.findByText("bare");
    fireEvent.keyDown(screen.getByRole("button", { name: "Open bare" }), { key: "Enter" });
    expect(screen.getByRole("heading", { name: "bare" })).toBeTruthy();
    expect(screen.queryByText("When to use")).toBeNull();
    expect(screen.queryByText("Phases")).toBeNull();
    expect(screen.getByText("0 phases")).toBeTruthy();
  });

  it("searches, filters by source and sorts by phases", async () => {
    mount(WORKFLOWS);
    await screen.findByText("triage");
    fireEvent.click(screen.getByRole("button", { name: "Search workflows" }));
    const box = screen.getByRole("textbox", { name: "Search workflows" });
    expect(box.getAttribute("placeholder")).toBe("Search 2 workflows…");
    fireEvent.change(box, { target: { value: "reproduce" } });
    expect(names()).toEqual(["triage"]);
    fireEvent.change(box, { target: { value: "release" } });
    expect(names()).toEqual(["audit"]);
    fireEvent.change(box, { target: { value: "nothing" } });
    expect(screen.getByText("No workflows match")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all workflows" }));
    expect(names()).toEqual(["audit", "triage"]);

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Yours" }));
    expect(names()).toEqual(["audit"]);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "This project's" }));
    expect(names()).toEqual(["triage"]);
    expect(screen.queryByText("No workflows match")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All workflows" }));

    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Most phases" }));
    expect(names()).toEqual(["triage", "audit"]);
  });

  it("says a source with nothing in it has nothing, without a search", async () => {
    mount([WORKFLOWS[0]]);
    await screen.findByText("triage");
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Yours" }));
    expect(screen.getByText("None from this source.")).toBeTruthy();
  });
});

describe("workflowsView", () => {
  it("reads the source from the path, counts phases, and tolerates missing fields", () => {
    expect(workflowSource({ path: "C:\\Users\\me\\.igni\\workflows\\a.mjs" })).toBe("user");
    expect(workflowSource({})).toBe("project");
    expect(phaseCount({})).toBe("0 phases");
    const rows: WorkflowMeta[] = [{ phases: [{}] }, { name: "b" }];
    expect(visibleWorkflows(rows, "", "all", "name").map((r) => r.name)).toEqual([undefined, "b"]);
    expect(visibleWorkflows(rows, "", "all", "phases").map((r) => r.name)).toEqual([undefined, "b"]);
    expect(visibleWorkflows([{}, {}], "", "all", "phases")).toHaveLength(2);
    expect(visibleWorkflows(rows, "x", "all", "name")).toHaveLength(0);
  });
});
