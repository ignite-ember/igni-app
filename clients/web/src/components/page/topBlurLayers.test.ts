/**
 * The top fade's blur stack, as tuned in the playground (``?demo=fade``):
 * eight layers from 0.625px to 5px, the weakest reaching 68px down and
 * the strongest solid above 18px.
 */

import { describe, expect, it } from "vitest";

import { TOP_BLUR, topBlurLayers } from "./topBlurLayers";

describe("topBlurLayers", () => {
  const layers = topBlurLayers();

  it("builds the tuned stack: eight layers in even steps up to 5px", () => {
    expect(TOP_BLUR).toEqual({ maxBlur: 5, layers: 8, start: 68, full: 18 });
    expect(layers.map((l) => l.blur)).toEqual([0.625, 1.25, 1.875, 2.5, 3.125, 3.75, 4.375, 5]);
  });

  it("gives each layer a band one step tall, from 68px up to 18px", () => {
    expect(layers[0].goneAt).toBe(68);
    expect(layers[0].solidTo).toBe(61.75);
    expect(layers[7].solidTo).toBe(18);
    for (let k = 1; k < layers.length; k++) expect(layers[k].goneAt).toBe(layers[k - 1].solidTo);
  });

  it("reaches each box past its band, so its blur samples below it instead of smearing", () => {
    for (const l of layers) expect(l.height).toBeGreaterThanOrEqual(l.goneAt + 24);
  });

  it("masks each layer on above its band and off below it", () => {
    for (const l of layers) {
      expect(l.mask.startsWith("linear-gradient(to bottom, #000 0px, rgba(0, 0, 0, 1.000) ")).toBe(true);
      expect(l.mask).toContain(`rgba(0, 0, 0, 0.000) ${l.goneAt.toFixed(2)}px`);
      expect(l.mask.endsWith("transparent 100%)")).toBe(true);
    }
  });
});
