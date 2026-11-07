import { describe, expect, it } from "vitest";
import { PlanTaskList, type PlanTask } from "./planTasks";

const normalizePlanTask = (raw: unknown) => PlanTaskList.parseTask(raw);
const normalizePlanTasks = (raw: unknown) => PlanTaskList.parse(raw).tasks;
const mergePlanTasks = (existing: PlanTask[], todos: unknown) =>
  new PlanTaskList(existing).mergeTodos(todos).tasks;

// ── Plan-task normalization (CC parity row 50) ──────────────
//
// The agent calls ``exit_plan_mode(plan, tasks=[...])`` and a
// ``plan_submitted`` push lands. The shape from the BE is loose
// (dict[str, Any]) so we have to be defensive about every field
// — a malformed task must drop, not crash the chat. These tests
// pin the contract the App.tsx channel handler relies on.

describe("PlanTaskList.parseTask", () => {
  it("normalizes a fully-formed task", () => {
    const out = normalizePlanTask({
      content: "Run tests",
      status: "in_progress",
      activeForm: "Running tests",
    });
    expect(out).toEqual({
      content: "Run tests",
      status: "in_progress",
      activeForm: "Running tests",
    });
  });

  it("drops tasks with empty content (after trim)", () => {
    // Empty content is unusable — the merge step matches by
    // content, so an empty-string key would collide with every
    // other empty task in the list.
    expect(normalizePlanTask({ content: "", status: "pending" })).toBeNull();
    expect(normalizePlanTask({ content: "   ", status: "pending" })).toBeNull();
    expect(normalizePlanTask({ status: "pending" })).toBeNull();
  });

  it("drops non-object input", () => {
    expect(normalizePlanTask(null)).toBeNull();
    expect(normalizePlanTask(undefined)).toBeNull();
    expect(normalizePlanTask("string")).toBeNull();
    expect(normalizePlanTask(42)).toBeNull();
    expect(normalizePlanTask([])).toBeNull();
  });

  it("trims content + activeForm", () => {
    const out = normalizePlanTask({
      content: "  spaced  ",
      activeForm: "  Spacing  ",
    });
    expect(out?.content).toBe("spaced");
    expect(out?.activeForm).toBe("Spacing");
  });

  it("defaults status to 'pending' when missing", () => {
    expect(normalizePlanTask({ content: "x" })?.status).toBe("pending");
  });

  it("defaults status to 'pending' for unknown values", () => {
    // Forward-compat: if the BE ever ships a new status the FE
    // doesn't know, treat it as pending rather than rendering
    // a confused/broken card.
    expect(
      normalizePlanTask({ content: "x", status: "blocked" })?.status,
    ).toBe("pending");
    expect(normalizePlanTask({ content: "x", status: 7 })?.status).toBe(
      "pending",
    );
  });

  it("defaults missing activeForm to empty string", () => {
    // Empty ``activeForm`` is fine — the renderer falls back to
    // ``content`` when there's no gerund to show.
    expect(normalizePlanTask({ content: "x" })?.activeForm).toBe("");
  });
});

describe("PlanTaskList.parse", () => {
  it("returns [] for non-array input", () => {
    expect(normalizePlanTasks(undefined)).toEqual([]);
    expect(normalizePlanTasks(null)).toEqual([]);
    expect(normalizePlanTasks({ tasks: [] })).toEqual([]);
    expect(normalizePlanTasks("not an array")).toEqual([]);
  });

  it("filters out unnormalizable entries silently", () => {
    const out = normalizePlanTasks([
      { content: "good", status: "pending" },
      null,
      { content: "" },
      "string",
      { content: "also good", status: "completed" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe("good");
    expect(out[1].content).toBe("also good");
  });

  it("preserves input order", () => {
    const out = normalizePlanTasks([
      { content: "a" },
      { content: "b" },
      { content: "c" },
    ]);
    expect(out.map((t) => t.content)).toEqual(["a", "b", "c"]);
  });
});

describe("PlanTaskList#mergeTodos", () => {
  const planTasks: PlanTask[] = [
    { content: "Read code", status: "completed", activeForm: "Reading code" },
    { content: "Run tests", status: "pending", activeForm: "Running tests" },
    { content: "Ship", status: "pending", activeForm: "Shipping" },
  ];

  it("returns the original list unchanged when it's empty", () => {
    // No plan-card tasks → nothing to merge into; same-reference
    // return spares React from a needless re-render via setState.
    const empty: PlanTask[] = [];
    expect(mergePlanTasks(empty, [{ content: "x", status: "completed" }])).toBe(
      empty,
    );
  });

  it("returns the original list unchanged when no todos match anything", () => {
    // Fast-path: an early ``todos_updated`` from an unrelated
    // run (separate chat session sharing the WS) must not blank
    // a PlanCard's checklist.
    const out = mergePlanTasks(planTasks, [
      { content: "Something else entirely", status: "completed" },
    ]);
    // Each task is exactly what it was — same statuses, same
    // activeForms.
    expect(out.map((t) => t.status)).toEqual(["completed", "pending", "pending"]);
  });

  it("updates statuses for matched tasks", () => {
    const out = mergePlanTasks(planTasks, [
      { content: "Run tests", status: "in_progress" },
      { content: "Ship", status: "in_progress" },
    ]);
    expect(out[0].status).toBe("completed"); // unchanged
    expect(out[1].status).toBe("in_progress");
    expect(out[2].status).toBe("in_progress");
  });

  it("preserves activeForm when the todo's is empty", () => {
    // The TodoStore sometimes doesn't carry activeForm (older
    // tools, sloppy callers). Falling back to the original
    // gerund keeps the rendered text stable as the task ticks.
    const out = mergePlanTasks(planTasks, [
      { content: "Run tests", status: "in_progress", activeForm: "" },
    ]);
    expect(out[1].activeForm).toBe("Running tests");
  });

  it("overrides activeForm when the todo's is non-empty", () => {
    const out = mergePlanTasks(planTasks, [
      {
        content: "Run tests",
        status: "in_progress",
        activeForm: "Executing the test suite",
      },
    ]);
    expect(out[1].activeForm).toBe("Executing the test suite");
  });

  it("keeps last-known status for tasks dropped from todos mid-flight", () => {
    // The agent may shorten the todo list as it works. The plan
    // card stays anchored to the plan the user approved — better
    // to show a stale-but-real status than to blank the row.
    const seeded: PlanTask[] = [
      { content: "Read code", status: "completed", activeForm: "Reading code" },
      { content: "Run tests", status: "in_progress", activeForm: "Running tests" },
    ];
    const out = mergePlanTasks(seeded, [
      // ``Read code`` dropped entirely from the new todo set.
      { content: "Run tests", status: "completed" },
    ]);
    expect(out[0].status).toBe("completed"); // last-known kept
    expect(out[1].status).toBe("completed"); // matched + updated
  });

  it("does not add NEW tasks from todos that aren't in the plan", () => {
    // The PlanCard reflects the user-approved plan, not the live
    // todo set. New todos appearing mid-run shouldn't graft
    // themselves into the card; the bare ``/todos`` view shows
    // those instead.
    const out = mergePlanTasks(planTasks, [
      { content: "Brand new task", status: "in_progress" },
    ]);
    expect(out).toHaveLength(planTasks.length);
    expect(out.every((t) => t.content !== "Brand new task")).toBe(true);
  });

  it("returns the original list when the todos value is unparseable", () => {
    // Non-array todos coming from a malformed push: noop, don't
    // clobber existing state.
    expect(mergePlanTasks(planTasks, undefined).map((t) => t.status)).toEqual([
      "completed",
      "pending",
      "pending",
    ]);
    expect(mergePlanTasks(planTasks, "garbage").map((t) => t.status)).toEqual([
      "completed",
      "pending",
      "pending",
    ]);
  });

  it("returns the same list (and the same PlanTaskList) when nothing parses", () => {
    const list = new PlanTaskList(planTasks);
    expect(list.mergeTodos(undefined)).toBe(list);
    expect(list.mergeTodos(undefined).tasks).toBe(planTasks);
    expect(list.mergeTodos([{ content: "" }]).tasks).toBe(planTasks);
  });
});

describe("PlanTaskList.labelOf", () => {
  const task = (status: PlanTask["status"], activeForm: string): PlanTask => ({
    content: "Run tests",
    status,
    activeForm,
  });

  it("shows the gerund while the task is in progress", () => {
    expect(PlanTaskList.labelOf(task("in_progress", "Running tests"))).toBe("Running tests");
  });

  it("falls back to the imperative when there is no gerund", () => {
    expect(PlanTaskList.labelOf(task("in_progress", ""))).toBe("Run tests");
  });

  it("shows the imperative once the task is not in progress", () => {
    expect(PlanTaskList.labelOf(task("pending", "Running tests"))).toBe("Run tests");
    expect(PlanTaskList.labelOf(task("completed", "Running tests"))).toBe("Run tests");
  });
});
