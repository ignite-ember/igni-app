// @vitest-environment jsdom
/**
 * A card says what it drew, so the agent can be told (R666).
 *
 * The visualizer's spec goes to the client and never comes back, so
 * the only thing the model could say about a card was what it hoped
 * for. The card now reports what it drew of it — and only a whole
 * card is reported, because a card still being drawn has not been
 * drawn yet.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Spec } from "@json-render/core";

import type { VisualizationItem } from "../../chat/chatItem";
import { VisualizationCard } from "./VisualizationCard";
import type { VisualizationHandlers } from "./handlers";

afterEach(() => cleanup());

const GOOD_SPEC: Spec = {
  root: "root",
  elements: {
    root: { type: "Card", props: { title: "Monthly Sales 2026" }, children: ["bar"] },
    bar: {
      type: "BarGraph",
      props: { data: [{ x: "Jan", y: 120 }, { x: "Feb", y: 135 }] },
      children: [],
    },
  },
};

const BROKEN_SPEC = {
  root: "root",
  elements: {
    root: { type: "Card", props: { title: "Monthly Sales 2026" }, children: ["bar"] },
    bar: { type: "BarGraph", props: { data: 42 }, children: [] },
  },
} as unknown as Spec;

const card = (over: Partial<VisualizationItem> = {}): VisualizationItem => ({
  kind: "visualization",
  id: 1,
  specId: "card-1",
  spec: GOOD_SPEC,
  title: "",
  sourceAgent: "visualizer",
  ...over,
});

const render_ = (item: VisualizationItem, handlers?: VisualizationHandlers): void => {
  render(<VisualizationCard item={item} handlers={handlers} />);
};

describe("a card in the chat", () => {
  it("says what it drew when the card is whole", () => {
    const reportVerdict = vi.fn();

    render_(
      card({ final: true, revision: 1 }),
      { reportVerdict },
    );

    expect(reportVerdict).toHaveBeenCalledWith({
      spec_id: "card-1",
      revision: 1,
      total: 2,
      failed: [],
      issues: [],
    });
  });

  it("says nothing while the card is still being drawn", () => {
    const reportVerdict = vi.fn();

    render_(card({ final: false }), { reportVerdict });

    expect(reportVerdict).not.toHaveBeenCalled();
  });

  it("says nothing about a card that names no draw", () => {
    const reportVerdict = vi.fn();

    render_(card({ final: true }), { reportVerdict });

    expect(reportVerdict).not.toHaveBeenCalled();
  });

  it("names the element it could not draw", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reportVerdict = vi.fn();

    render_(
      card({ spec: BROKEN_SPEC, final: true, revision: 2 }),
      { reportVerdict },
    );

    expect(reportVerdict).toHaveBeenCalledWith({
      spec_id: "card-1",
      revision: 2,
      total: 2,
      failed: [{ type: "BarGraph", message: "its data is not a list" }],
      issues: [],
    });
  });

  it("carries what was wrong with the card's shape", () => {
    const reportVerdict = vi.fn();

    render_(
      card({ final: true, revision: 1, notices: ["its child 'chart' is not an element of it"] }),
      { reportVerdict },
    );

    expect(reportVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: ["its child 'chart' is not an element of it"],
      }),
    );
  });

  // R666, finding (a): when a card was drawn again, the draw before it
  // spoke during the new draw — its verdict went out a second time,
  // mid-draw, so the backend heard the old revision's numbers while the
  // card showed the new one. A draw now speaks only for itself.
  it("a new draw is not answered for by the draw before it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reportVerdict = vi.fn();
    const { rerender } = render(
      <VisualizationCard item={card({ final: true, revision: 1 })} handlers={{ reportVerdict }} />,
    );
    reportVerdict.mockClear();

    rerender(
      <VisualizationCard
        item={card({ spec: BROKEN_SPEC, final: true, revision: 2 })}
        handlers={{ reportVerdict }}
      />,
    );

    expect(reportVerdict.mock.calls.map((c) => c[0].revision)).not.toContain(1);
    expect(reportVerdict).toHaveBeenLastCalledWith({
      spec_id: "card-1",
      revision: 2,
      total: 2,
      failed: [{ type: "BarGraph", message: "its data is not a list" }],
      issues: [],
    });
  });

  it("a redraw that still cannot draw an element says so", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reportVerdict = vi.fn();
    const again = () => JSON.parse(JSON.stringify(BROKEN_SPEC)) as Spec;
    const { rerender } = render(
      <VisualizationCard item={card({ spec: again(), final: true, revision: 1 })} handlers={{ reportVerdict }} />,
    );

    rerender(
      <VisualizationCard item={card({ spec: again(), final: true, revision: 2 })} handlers={{ reportVerdict }} />,
    );

    const revision2 = reportVerdict.mock.calls.map((c) => c[0]).filter((v) => v.revision === 2);
    expect(revision2.length).toBeGreaterThan(0);
    for (const verdict of revision2) {
      expect(verdict.failed).toEqual([{ type: "BarGraph", message: "its data is not a list" }]);
    }
  });

  it("draws without a listener", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render_(card({ spec: BROKEN_SPEC, final: true, revision: 1 }))).not.toThrow();
  });
});
