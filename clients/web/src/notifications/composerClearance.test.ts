import { describe, expect, it } from "vitest";

import { ComposerClearance } from "./composerClearance";

const clearance = new ComposerClearance(360, 16);
const VIEW = { width: 1280, height: 800 };

describe("ComposerClearance", () => {
  it("sits in the corner when there is no composer", () => {
    expect(clearance.bottomFor(null, VIEW)).toBe(16);
  });

  it("sits in the corner when the composer is clear of it", () => {
    // Stack starts at 1280 - 16 - 360 = 904; composer ends at 880.
    expect(clearance.bottomFor({ left: 300, right: 880, top: 660, bottom: 780 }, VIEW)).toBe(16);
  });

  it("lifts above the composer when the two would overlap", () => {
    expect(clearance.bottomFor({ left: 300, right: 1000, top: 660, bottom: 780 }, VIEW)).toBe(800 - 660 + 16);
  });

  it("lifts when the gap to the composer is less than the gutter", () => {
    // 904 - 16 = 888: a composer ending at 889 is too close.
    expect(clearance.bottomFor({ left: 300, right: 889, top: 660, bottom: 780 }, VIEW)).toBe(156);
    expect(clearance.bottomFor({ left: 300, right: 888, top: 660, bottom: 780 }, VIEW)).toBe(16);
  });

  it("ignores a composer that is not on screen (hidden under a page)", () => {
    // display: none measures as an empty box at the origin.
    expect(clearance.bottomFor({ left: 0, right: 0, top: 0, bottom: 0 }, VIEW)).toBe(16);
    expect(clearance.bottomFor({ left: 0, right: 1280, top: 800, bottom: 900 }, VIEW)).toBe(16);
  });

  it("lifts over the composer on a narrow window", () => {
    const narrow = { width: 400, height: 700 };
    expect(clearance.bottomFor({ left: 16, right: 384, top: 600, bottom: 690 }, narrow)).toBe(116);
  });

  it("never sits closer to the edge than the gutter", () => {
    expect(clearance.bottomFor({ left: 0, right: 1280, top: 799, bottom: 800 }, VIEW)).toBe(17);
    expect(clearance.bottomFor({ left: 0, right: 1280, top: 795, bottom: 800 }, VIEW)).toBe(21);
  });
});
