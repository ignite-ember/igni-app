/**
 * The values a chart draws.
 *
 * The catalog declares a series point's ``y`` a number, and the
 * visualizer's prompt is generated from that catalog — but a model igni
 * does not fine-tune writes the value as text, and the chart then had
 * nothing to draw: the series was empty, the card said "no data", and
 * the agent said the chart was above (R666). These tests pin how a
 * value is read, and what a chart says when a value is not a number at
 * all.
 */

import { describe, expect, it } from "vitest";
import {
  completeOHLC,
  completeSeries,
  rows,
  type OHLCPoint,
  type SeriesPoint,
} from "./chartGeometry";

/** A row as a model writes it: the value as text. */
const asText = (row: Record<string, unknown>): SeriesPoint => row as unknown as SeriesPoint;
const ohlc = (row: Record<string, unknown>): OHLCPoint => row as unknown as OHLCPoint;

describe("rows", () => {
  it("says so when a chart's data is not a list", () => {
    expect(() => rows(42 as unknown as number[])).toThrow("its data is not a list");
  });

  it("treats absent data as no rows yet", () => {
    expect(rows(null)).toEqual([]);
    expect(rows(undefined)).toEqual([]);
  });
});

describe("completeSeries", () => {
  it("reads a value written as text as the number it stands for", () => {
    const complete = completeSeries([
      asText({ x: "Jan", y: "120" }),
      asText({ x: "Feb", y: "135" }),
    ]);
    expect(complete).toEqual([
      { x: "Jan", y: 120 },
      { x: "Feb", y: 135 },
    ]);
  });

  it("reads a value written with a sign and a decimal point", () => {
    const complete = completeSeries([asText({ x: "Jan", y: " -12.5 " })]);
    expect(complete).toEqual([{ x: "Jan", y: -12.5 }]);
  });

  it("keeps a value that is already a number", () => {
    expect(completeSeries([{ x: "Jan", y: 120 }])).toEqual([{ x: "Jan", y: 120 }]);
  });

  it("drops a row whose value has not arrived yet", () => {
    // Mid-stream, partial-json hands us a row without its value.
    const complete = completeSeries([
      asText({ x: "Jan" }),
      { x: "Feb", y: 135 },
    ]);
    expect(complete).toEqual([{ x: "Feb", y: 135 }]);
  });

  it("says so when no row has a value that is a number", () => {
    expect(() =>
      completeSeries([asText({ x: "Jan", y: "n/a" }), asText({ x: "Feb", y: "n/a" })]),
    ).toThrow("its y values are not numbers");
  });

  it("draws the rows it can when only some values are wrong", () => {
    const complete = completeSeries([
      { x: "Jan", y: 120 },
      asText({ x: "Feb", y: "n/a" }),
    ]);
    expect(complete).toEqual([{ x: "Jan", y: 120 }]);
  });

  it("does not mistake empty text for zero", () => {
    expect(() => completeSeries([asText({ x: "Jan", y: "" })])).toThrow(
      "its y values are not numbers",
    );
  });

  it("drops a row with no label", () => {
    expect(completeSeries([asText({ x: null, y: 1 })])).toEqual([]);
  });
});

describe("completeOHLC", () => {
  it("reads prices written as text as the numbers they stand for", () => {
    const complete = completeOHLC([
      ohlc({ x: "Mar", o: "10", h: "14", l: "9", c: "13" }),
    ]);
    expect(complete).toEqual([{ x: "Mar", o: 10, h: 14, l: 9, c: 13 }]);
  });

  it("keeps the volume when it is there", () => {
    const complete = completeOHLC([
      { x: "Mar", o: 10, h: 14, l: 9, c: 13, v: 100 },
    ]);
    expect(complete).toEqual([{ x: "Mar", o: 10, h: 14, l: 9, c: 13, v: 100 }]);
  });

  it("says so when no row has prices that are numbers", () => {
    expect(() =>
      completeOHLC([ohlc({ x: "Mar", o: "a", h: "b", l: "c", c: "d" })]),
    ).toThrow("its prices are not numbers");
  });
});
