// @vitest-environment jsdom
/**
 * The scheduled-tasks page: what is waiting, what ran, and what a person
 * can do about a task — run it now, or cancel it while it is still live.
 *
 * Pinned here: the default view is the live tasks, done ones stay
 * readable behind a filter, a finished task never offers Cancel, and a
 * backend that fails the list call reads as "nothing scheduled" rather
 * than a page stuck on "Loading…". A card opens the task's own page —
 * never an in-place expansion — where the whole output reads and copies,
 * Run now and Cancel act, and back lands on the list as it was left.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PageContext } from "../PageShell";
import { SchedulePanel } from "./SchedulePanel";
import { looksLikeMarkdown } from "./schedule/scheduleView";

afterEach(cleanup);

interface Task {
  id?: string;
  description?: string;
  scheduled_at?: string;
  status?: string;
  recurrence?: string;
  result?: string;
  error?: string;
  created_at?: string;
}

const TASKS: Task[] = [
  {
    id: "t-ok",
    description: "Nightly dependency audit",
    scheduled_at: "2026-11-01T02:00:00Z",
    status: "completed",
    result: "No **new** advisories.",
  },
  {
    id: "t-live",
    description: "Summarise open PRs",
    scheduled_at: "2026-11-04T09:00:00Z",
    status: "pending",
    recurrence: "every day",
  },
  {
    id: "t-bad",
    description: "Rotate the staging token",
    scheduled_at: "2026-11-02T03:00:00Z",
    status: "failed",
    error: "permission denied",
  },
  { id: "t-off", description: "Old reminder", status: "cancelled" },
  { id: "t-run", status: "running", scheduled_at: "2026-11-03T10:00:00Z" },
];

function panelWith(
  tasks: Task[] | Error,
  { asPage = false, run }: { asPage?: boolean; run?: (params: unknown) => Promise<unknown> } = {},
) {
  const calls: { method: string; params: unknown }[] = [];
  const rpc = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params });
    if (method === "get_scheduled_tasks") {
      if (tasks instanceof Error) throw tasks;
      return tasks;
    }
    if (method === "execute_scheduled_task" && run) return run(params);
    return { ok: true };
  });
  const panel = <SchedulePanel client={{ rpc } as never} onClose={() => {}} />;
  const trail = [{ kind: "schedule", label: "Scheduled tasks" } as never];
  render(
    asPage ? (
      <PageContext.Provider value={{ trail, onCrumb: () => {}, onBack: () => {}, onClose: () => {} }}>
        {panel}
      </PageContext.Provider>
    ) : (
      panel
    ),
  );
  return { rpc, calls };
}

/** Opens the task card named `name` and returns its page's hero heading. */
async function openTask(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Open ${name}` }));
  return screen.getByRole("heading", { name });
}

const cardNames = () => [...document.querySelectorAll(".task-card .entity-card-name")].map((n) => n.textContent);

describe("what is scheduled", () => {
  it("asks for done tasks too, so past results stay readable", async () => {
    const { calls } = panelWith([]);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual({
      method: "get_scheduled_tasks",
      params: { include_done: true },
    });
  });

  it("says how to schedule something when nothing is", async () => {
    panelWith([]);
    expect(await screen.findByText(/Nothing scheduled/)).toBeTruthy();
    // No tabs or search over an empty list.
    expect(screen.queryByRole("button", { name: "Search tasks" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Active/ })).toBeNull();
  });

  it("reads a failed list call as nothing scheduled, not as loading forever", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    panelWith(new Error("backend gone"));
    expect(await screen.findByText(/Nothing scheduled/)).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
    err.mockRestore();
  });

  it("shows the live tasks first and only them by default", async () => {
    panelWith(TASKS);
    await screen.findByText("Summarise open PRs");
    expect(screen.getByText("(no description)")).toBeTruthy();
    expect(screen.queryByText("Nightly dependency audit")).toBeNull();
    expect(screen.queryByText("Rotate the staging token")).toBeNull();
    expect(screen.getByText("every day")).toBeTruthy();
  });

  it("counts each band on its filter", async () => {
    panelWith(TASKS);
    await screen.findByText("Summarise open PRs");
    const count = (label: string) =>
      screen.getByRole("button", { name: new RegExp(`^${label}`) }).textContent;
    expect(count("Active")).toBe("Active2");
    expect(count("All")).toBe("All5");
    expect(count("Done")).toBe("Done1");
    expect(count("Failed")).toBe("Failed1");
    expect(count("Cancelled")).toBe("Cancelled1");
  });

  it("puts live tasks above finished ones under All, newest first within a band", async () => {
    panelWith(TASKS);
    await screen.findByText("Summarise open PRs");
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(cardNames()).toEqual([
      "Summarise open PRs",
      "(no description)",
      "Rotate the staging token",
      "Nightly dependency audit",
      "Old reminder",
    ]);
  });

  it("filters by description or id, and says when nothing matches", async () => {
    panelWith(TASKS);
    await screen.findByText("Summarise open PRs");
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.click(screen.getByRole("button", { name: "Search tasks" }));
    const search = screen.getByPlaceholderText(/Search description/);
    fireEvent.change(search, { target: { value: "T-BAD" } });
    expect(screen.getByText("Rotate the staging token")).toBeTruthy();
    expect(screen.queryByText("Summarise open PRs")).toBeNull();
    fireEvent.change(search, { target: { value: "audit" } });
    expect(screen.getByText("Nightly dependency audit")).toBeTruthy();
    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.getByText("No tasks match")).toBeTruthy();
  });
});

describe("sorting and tabs", () => {
  it("sorts soonest first or by name from the Sort menu", async () => {
    panelWith(TASKS);
    await screen.findByText("Summarise open PRs");
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Soonest first" }));
    expect(cardNames()).toEqual([
      "Nightly dependency audit",
      "Rotate the staging token",
      "(no description)",
      "Summarise open PRs",
      "Old reminder",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(cardNames()).toEqual([
      "(no description)",
      "Nightly dependency audit",
      "Old reminder",
      "Rotate the staging token",
      "Summarise open PRs",
    ]);
  });

  it("marks the open tab and says what an empty one means", async () => {
    panelWith(TASKS.filter((t) => t.status === "completed"));
    await screen.findByText("Nothing waiting to run");
    expect(screen.getByRole("button", { name: /^Active/ }).className).toContain("active");
    fireEvent.click(screen.getByRole("button", { name: /^Failed/ }));
    expect(screen.getByText("Nothing has failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Cancelled/ }));
    expect(screen.getByText("Nothing cancelled")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(screen.getByText("Nightly dependency audit")).toBeTruthy();
  });

  it("labels when a task runs by whether it still will", async () => {
    panelWith(TASKS);
    await screen.findByText("Summarise open PRs");
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getAllByText(/^Next run /)).toHaveLength(2);
    expect(screen.getAllByText(/^Ran /)).toHaveLength(2);
    // The cancelled task has no time, so nothing is said about it.
    expect(screen.queryByText(/^Was due /)).toBeNull();
  });
});

describe("a task's page", () => {
  it("opens from the card, not by expanding it in place", async () => {
    panelWith(TASKS);
    await screen.findByText("Summarise open PRs");
    expect(document.querySelector(".task-card [aria-expanded], .task-card[aria-expanded]")).toBeNull();
    expect(await openTask("Summarise open PRs")).toBeTruthy();
    // The list is gone: the page shows this one task.
    expect(document.querySelector(".task-card")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Active/ })).toBeNull();
    expect(screen.getByText(/hasn't run/)).toBeTruthy();
  });

  it("opens from the keyboard too", async () => {
    panelWith(TASKS);
    const card = await screen.findByRole("button", { name: "Open Summarise open PRs" });
    fireEvent.keyDown(card, { key: "Enter" });
    expect(screen.getByRole("heading", { name: "Summarise open PRs" })).toBeTruthy();
  });

  it("puts the status, schedule and times in the hero and the facts", async () => {
    panelWith([{ ...TASKS[1], created_at: "2026-10-30T08:00:00Z" }]);
    await openTask("Summarise open PRs");
    const hero = document.querySelector(".entity-hero") as HTMLElement;
    expect(hero.querySelector(".hero-chip")!.textContent).toBe("pending");
    expect(hero.textContent).toContain("every day");
    expect(hero.textContent).toMatch(/Next run /);
    const facts = Object.fromEntries(
      [...document.querySelectorAll(".detail-fact")].map((f) => [
        f.querySelector("dt")!.textContent,
        f.querySelector("dd")!.textContent,
      ]),
    );
    expect(Object.keys(facts)).toEqual(["ID", "Schedule", "Next run", "Created"]);
    expect(facts.ID).toBe("t-live");
    expect(facts.Schedule).toBe("every day");
  });

  it("names a finished task's time its last run, and a one-shot's schedule once", async () => {
    panelWith(TASKS);
    fireEvent.click(await screen.findByRole("button", { name: /^Done/ }));
    await openTask("Nightly dependency audit");
    const labels = [...document.querySelectorAll(".detail-fact dt")].map((d) => d.textContent);
    expect(labels).toEqual(["ID", "Schedule", "Last run"]);
    expect(screen.getByText("Once")).toBeTruthy();
    expect(document.querySelector(".entity-hero")!.textContent).toContain("once");
  });

  it("shows a markdown result as markdown, and offers no Cancel once done", async () => {
    panelWith(TASKS);
    fireEvent.click(await screen.findByRole("button", { name: /^Done/ }));
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await openTask("Nightly dependency audit");
    expect(screen.getByRole("region", { name: "Output" })).toBeTruthy();
    expect(screen.getByText("new").tagName).toBe("STRONG");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("shows a long plain output whole, in a mono block, and copies all of it", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const long = Array.from({ length: 4000 }, (_, i) => `line ${i} of the build log`).join("\n");
    panelWith([{ id: "t-long", description: "Build", status: "completed", result: long }]);
    fireEvent.click(await screen.findByRole("button", { name: /^All/ }));
    await openTask("Build");
    const block = document.querySelector(".mono-block") as HTMLElement;
    expect(block.tagName).toBe("PRE");
    expect(block.textContent).toBe(long);
    expect(block.textContent).toContain("line 3999 of the build log");
    fireEvent.click(screen.getByRole("button", { name: "Copy the output" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(long));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("shows a failed task's error whole, and copies it", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    panelWith(TASKS);
    fireEvent.click(await screen.findByRole("button", { name: /^Failed/ }));
    await openTask("Rotate the staging token");
    const block = screen.getByRole("region", { name: "Error" }).querySelector(".mono-block")!;
    expect(block.className).toContain("is-danger");
    expect(block.textContent).toBe("permission denied");
    expect(screen.queryByRole("region", { name: "Output" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy the error" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("permission denied"));
  });

  it("says a cancelled task never ran, and when it was due", async () => {
    panelWith([{ id: "x", description: "Late", status: "cancelled", scheduled_at: "2026-11-01T02:00:00Z" }]);
    fireEvent.click(await screen.findByRole("button", { name: /^Cancelled/ }));
    expect(screen.getByText(/^Was due /)).toBeTruthy();
    await openTask("Late");
    expect(screen.getByText("Cancelled before it ran.")).toBeTruthy();
    expect(screen.getByText("Was due", { selector: "dt" })).toBeTruthy();
  });

  it("follows the latest poll while open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let tasks: Task[] = [{ id: "t1", description: "Flip", status: "running" }];
      const rpc = vi.fn(async () => tasks);
      render(<SchedulePanel client={{ rpc } as never} onClose={() => {}} />);
      await openTask("Flip");
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
      tasks = [{ id: "t1", description: "Flip", status: "completed", result: "done and dusted" }];
      await vi.advanceTimersByTimeAsync(3_000);
      await waitFor(() => expect(screen.getByText("done and dusted")).toBeTruthy());
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs the task's description now and shows the answer", async () => {
    let finish: (v: unknown) => void = () => {};
    const { calls } = panelWith(TASKS, { run: () => new Promise((r) => (finish = r)) });
    await openTask("Summarise open PRs");
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(calls.find((c) => c.method === "execute_scheduled_task")!.params).toEqual({
      description: "Summarise open PRs",
    });
    expect(screen.getByText("Running…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement).disabled).toBe(true);
    finish({ run_id: "sched-1", result: "Three PRs open." });
    expect(await screen.findByText("Three PRs open.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Run now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the run's answer" })).toBeTruthy();
  });

  it("says why a run failed, and when it said nothing", async () => {
    let answer: () => Promise<unknown> = async () => {
      throw new Error("policy refused the run");
    };
    panelWith(TASKS, { run: () => answer() });
    await openTask("Summarise open PRs");
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(await screen.findByText("policy refused the run")).toBeTruthy();
    answer = async () => ({ run_id: "r", result: "" });
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(await screen.findByText("The run said nothing.")).toBeTruthy();
    expect(screen.queryByText("policy refused the run")).toBeNull();
    answer = async () => {
      throw "plain refusal";
    };
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(await screen.findByText("plain refusal")).toBeTruthy();
    answer = async () => null;
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(await screen.findByText("The run said nothing.")).toBeTruthy();
  });

  it("does not offer Run now for a task with nothing to run", async () => {
    const { calls } = panelWith([{ id: "t-run", status: "running" }]);
    await openTask("(no description)");
    const run = screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    fireEvent.click(run);
    expect(calls.some((c) => c.method === "execute_scheduled_task")).toBe(false);
  });

  it("cancels from its page, as a danger button, then reloads", async () => {
    const { calls } = panelWith(TASKS);
    await openTask("Summarise open PRs");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.className).toContain("button--danger");
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(calls.find((c) => c.method === "cancel_scheduled_task")?.params).toEqual({ task_id: "t-live" }),
    );
    await waitFor(() => expect(calls.filter((c) => c.method === "get_scheduled_tasks").length).toBe(2));
    await waitFor(() => expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("offers no Cancel on the page of a live task with no id", async () => {
    panelWith([{ description: "Anonymous", status: "pending" }]);
    await openTask("Anonymous");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("goes back to the list as it was left: tab, search and scroll", async () => {
    panelWith(TASKS, { asPage: true });
    await screen.findByText("Summarise open PRs");
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.click(screen.getByRole("button", { name: "Search tasks" }));
    fireEvent.change(screen.getByPlaceholderText(/Search description/), { target: { value: "audit" } });
    const scroller = document.querySelector(".page-body") as HTMLElement;
    scroller.scrollTop = 240;
    await openTask("Nightly dependency audit");
    expect(scroller.scrollTop).toBe(0);
    // The trail names the task; its parent crumb goes back.
    fireEvent.click(screen.getByRole("button", { name: "Scheduled tasks" }));
    expect(screen.queryByRole("heading", { name: "Nightly dependency audit" })).toBeNull();
    expect(cardNames()).toEqual(["Nightly dependency audit"]);
    expect((screen.getByPlaceholderText(/Search description/) as HTMLInputElement).value).toBe("audit");
    expect(screen.getByRole("button", { name: /^All/ }).className).toContain("active");
    expect(scroller.scrollTop).toBe(240);
  });
});

describe("telling markdown from plain output", () => {
  it.each([
    ["# Heading", true],
    ["- item", true],
    ["1. first", true],
    ["some **bold** text", true],
    ["```\ncode\n```", true],
    ["see [docs](https://x.test)", true],
    ["> quoted", true],
    ["| a | b |", true],
    ["exit 0\nbuilt 12 files in 3.2s", false],
    ["2 * 3 = 6", false],
  ])("%j reads as markdown: %s", (text, md) => {
    expect(looksLikeMarkdown(text)).toBe(md);
  });
});

describe("cancelling", () => {
  it("cancels by id from the card without opening it, then reloads the list", async () => {
    const { calls } = panelWith(TASKS);
    await screen.findByText("Summarise open PRs");
    const [first] = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(first);
    await waitFor(() =>
      expect(calls.some((c) => c.method === "cancel_scheduled_task")).toBe(true),
    );
    expect(calls.find((c) => c.method === "cancel_scheduled_task")!.params).toEqual({
      task_id: "t-live",
    });
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "get_scheduled_tasks").length).toBe(2),
    );
    expect(screen.queryByRole("heading", { name: "Summarise open PRs" })).toBeNull();
  });

  it("keeps Cancel beside the card's own button, never inside its name", async () => {
    panelWith(TASKS);
    await screen.findByText("Summarise open PRs");
    const name = screen.getByText("Summarise open PRs");
    const [cancel] = screen.getAllByRole("button", { name: "Cancel" });
    expect(name.contains(cancel)).toBe(false);
  });

  it("sends nothing for a task without an id", async () => {
    const { calls } = panelWith([{ description: "Anonymous", status: "pending" }]);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await Promise.resolve();
    expect(calls.some((c) => c.method === "cancel_scheduled_task")).toBe(false);
  });

  it("polls while open and stops when closed", async () => {
    vi.useFakeTimers();
    try {
      const rpc = vi.fn(async () => []);
      const { unmount } = render(
        <SchedulePanel client={{ rpc } as never} onClose={() => {}} />,
      );
      expect(rpc).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(rpc).toHaveBeenCalledTimes(2);
      unmount();
      await vi.advanceTimersByTimeAsync(9_000);
      expect(rpc).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
