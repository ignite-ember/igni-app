/**
 * The shapes a spec may arrive in.
 *
 * A model igni does not fine-tune writes an array inside an object
 * under a single ``item`` key; the renderer reads that wrapper as the
 * list it stands for, so the card draws instead of saying it could
 * not (R666). These tests pin that reading, and pin the two things
 * it must NOT do: forgive a shape that is not a wrapper, and touch
 * the rows of a table.
 */

import { describe, expect, it } from "vitest";
import type { Spec } from "@json-render/core";
import { normaliseSpec } from "./specShape";

const WRAPPED: Spec = {
  root: "root",
  elements: {
    root: { type: "Card", props: { title: "Monthly Sales 2026" }, children: ["bar"] },
    bar: {
      type: "BarGraph",
      props: { data: { item: [{ x: "Jan", y: 120 }, { x: "Feb", y: 135 }] } },
      children: [],
    },
  },
} as unknown as Spec;

describe("a spec whose arrays are wrapped", () => {
  it("reads a chart's data as the list it stands for", () => {
    const spec = normaliseSpec(WRAPPED);
    const bar = spec.elements.bar as unknown as { props: { data: unknown } };
    expect(bar.props.data).toEqual([{ x: "Jan", y: 120 }, { x: "Feb", y: 135 }]);
  });

  it("reads a Table's columns and rows as the lists they stand for", () => {
    const spec = normaliseSpec({
      root: "t",
      elements: {
        t: {
          type: "Table",
          props: {
            columns: { item: [{ key: "provider", label: "Provider" }] },
            rows: { item: [{ provider: "AWS" }] },
          },
          children: [],
        },
      },
    } as unknown as Spec);
    const table = spec.elements.t as unknown as { props: { columns: unknown; rows: unknown } };
    expect(table.props.columns).toEqual([{ key: "provider", label: "Provider" }]);
    expect(table.props.rows).toEqual([{ provider: "AWS" }]);
  });

  it("reads a state's value as the list it stands for", () => {
    const spec = normaliseSpec({
      root: "root",
      elements: { root: { type: "Card", props: {}, children: [] } },
      state: { points: { item: [{ x: "Jan", y: 1 }] } },
    } as unknown as Spec);
    expect((spec as unknown as { state: Record<string, unknown> }).state.points).toEqual([
      { x: "Jan", y: 1 },
    ]);
  });

  it("reads a wrapper nested in a prop as the list it stands for", () => {
    const spec = normaliseSpec({
      root: "root",
      elements: {
        root: { type: "Card", props: { panel: { rows: { item: [1, 2] } } }, children: [] },
      },
    } as unknown as Spec);
    const root = spec.elements.root as unknown as { props: { panel: { rows: unknown } } };
    expect(root.props.panel.rows).toEqual([1, 2]);
  });
});

describe("a spec that needs no fixing", () => {
  it("comes back as it was", () => {
    const spec: Spec = {
      root: "root",
      elements: {
        root: { type: "Card", props: { title: "Sales" }, children: ["bar"] },
        bar: { type: "BarGraph", props: { data: [{ x: "Jan", y: 1 }] }, children: [] },
      },
    };
    expect(normaliseSpec(spec)).toBe(spec);
  });

  it("leaves a shape that is not a wrapper alone", () => {
    const spec = normaliseSpec({
      root: "root",
      elements: {
        root: { type: "Card", props: { title: "Sales" }, children: [] },
        bar: { type: "BarGraph", props: { data: { values: [1, 2] } }, children: [] },
      },
    } as unknown as Spec);
    const bar = spec.elements.bar as unknown as { props: { data: unknown } };
    expect(bar.props.data).toEqual({ values: [1, 2] });
  });

  it("leaves a row's own item key alone", () => {
    const spec = normaliseSpec({
      root: "t",
      elements: {
        t: {
          type: "Table",
          props: {
            columns: [{ key: "item", label: "Item" }],
            rows: [{ item: ["a", "b"] }],
          },
          children: [],
        },
      },
    } as unknown as Spec);
    const table = spec.elements.t as unknown as { props: { rows: unknown } };
    expect(table.props.rows).toEqual([{ item: ["a", "b"] }]);
  });

  it("leaves a spec it cannot draw alone", () => {
    const spec = { elements: "not a map", root: "root" } as unknown as Spec;
    expect(normaliseSpec(spec)).toBe(spec);
  });
});
