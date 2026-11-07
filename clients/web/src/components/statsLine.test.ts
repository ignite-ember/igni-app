import { describe, expect, it } from "vitest";
import type { StatsItem } from "../chat/chatItem";
import { formatStats, formatTokenCount } from "./statsLine";

function stats(overrides: Partial<StatsItem> = {}): StatsItem {
  return {
    kind: "stats",
    id: 1,
    runId: "r1",
    inputTokens: 27400,
    outputTokens: 240,
    reasoningTokens: 0,
    visibleThinkTokens: 0,
    visibleOutTokens: 240,
    duration: 12.4,
    corrected: false,
    ...overrides,
  };
}

describe("formatStats", () => {
  it("reads input, output and duration, with no glyph", () => {
    expect(formatStats(stats())).toBe("27.4k in · 240 out · 12.4s");
  });

  it("adds a think segment only when the turn rendered thinking", () => {
    expect(formatStats(stats({ visibleThinkTokens: 280, visibleOutTokens: 50 }))).toBe(
      "27.4k in · 280 think · 50 out · 12.4s",
    );
  });

  it("formats minutes, and skips a zero duration", () => {
    expect(formatStats(stats({ duration: 75 }))).toContain("1m 15s");
    expect(formatStats(stats({ inputTokens: 1000, visibleOutTokens: 1, duration: 0 }))).toBe(
      "1.0k in · 1 out",
    );
  });
});

describe("formatTokenCount", () => {
  it("compacts thousands to one decimal and leaves smaller counts alone", () => {
    expect(formatTokenCount(230)).toBe("230");
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1234)).toBe("1.2k");
    expect(formatTokenCount(30000)).toBe("30.0k");
  });
});
