/**
 * The gaps in a spec.
 *
 * A model that breaks the visualizer's naming rules does not fail
 * loudly — the FE prunes what does not resolve, and the card comes out
 * empty or half drawn while the agent says the chart is above (R666).
 * These tests pin what the card says about those specs.
 */

import { describe, expect, it } from "vitest";
import { specIssues, specIssueText } from "./specIntegrity";

/** A root that points at a chart that is not an element. */
const DANGLING_CHILD = {
  root: "root",
  elements: {
    root: { type: "Stack", children: ["title", "chart", "table"] },
    title: { type: "Heading", props: { text: "Cloud Spend" }, children: [] },
  },
};

/** Elements that are all there, but nothing points at them. */
const ORPHANS = {
  root: "root",
  elements: {
    root: { type: "Stack" },
    card: { type: "Card", children: ["chart", "table"] },
    chart: { type: "BarGraph", props: { data: [] }, children: "" },
    table: { type: "Table", props: { columns: [], rows: [] }, children: [] },
  },
};

const GOOD = {
  root: "root",
  elements: {
    root: { type: "Stack", children: ["card"] },
    card: { type: "Card", children: ["chart"] },
    chart: { type: "BarGraph", props: { data: [{ x: "Q1", y: 1 }] }, children: [] },
  },
};

describe("specIssues", () => {
  it("names the child ids that are not elements", () => {
    const { missing } = specIssues(DANGLING_CHILD);
    expect(missing).toEqual(["chart", "table"]);
  });

  it("names the elements nothing refers to", () => {
    const { unreachable } = specIssues(ORPHANS);
    expect(unreachable).toEqual(["card", "chart", "table"]);
  });

  it("finds nothing in a spec that hangs together", () => {
    expect(specIssues(GOOD)).toEqual({ missing: [], unreachable: [] });
  });

  it("says nothing about a spec whose root is not an element", () => {
    // The render layer says that one itself ("its root is not an
    // element key"); two complaints for one fault is noise.
    expect(specIssues({ root: "root", elements: {} })).toEqual({
      missing: [],
      unreachable: [],
    });
  });

  it("says nothing about a spec with no elements", () => {
    expect(specIssues({ root: "root" })).toEqual({ missing: [], unreachable: [] });
    expect(specIssues("nope")).toEqual({ missing: [], unreachable: [] });
  });

  it("walks the whole tree, not only the root's children", () => {
    const spec = {
      root: "root",
      elements: {
        root: { type: "Stack", children: ["card"] },
        card: { type: "Card", children: ["chart"] },
        chart: { type: "BarGraph", children: [] },
      },
    };
    expect(specIssues(spec)).toEqual({ missing: [], unreachable: [] });
  });
});

describe("specIssueText", () => {
  it("says what the card could not draw", () => {
    expect(specIssueText(DANGLING_CHILD)).toEqual([
      "its children 'chart' and 'table' are not elements of it",
    ]);
  });

  it("says when nothing refers to the elements", () => {
    expect(specIssueText(ORPHANS)).toEqual([
      "nothing refers to the elements 'card', 'chart' and 'table', so they are not drawn",
    ]);
  });

  it("says nothing about a spec that hangs together", () => {
    expect(specIssueText(GOOD)).toEqual([]);
  });

  it("uses the singular for one", () => {
    const spec = {
      root: "root",
      elements: { root: { type: "Stack", children: ["chart"] } },
    };
    expect(specIssueText(spec)).toEqual([
      "its child 'chart' is not an element of it",
    ]);
  });

  it("says both when a spec is broken two ways", () => {
    const spec = {
      root: "root",
      elements: {
        root: { type: "Stack", children: ["chart"] },
        extra: { type: "Text", children: [] },
      },
    };
    expect(specIssueText(spec)).toEqual([
      "its child 'chart' is not an element of it",
      "nothing refers to the element 'extra', so it is not drawn",
    ]);
  });
});
