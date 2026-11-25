import { describe, expect, it } from "vitest";

import { parseSentimentAspects } from "./sentimentAspects";

const WIRE = [
  "feeling",
  "gesture",
  "negative_reason",
  "positive_reason",
  "repeat",
  "redo_requested",
  "task_done",
  "intensity",
];

function aspect(answer: string) {
  return {
    answer,
    probabilities: [
      { label: answer, probability: 0.9 },
      { label: "other", probability: 0.1 },
    ],
  };
}

function wire(overrides: Record<string, unknown> = {}) {
  return { ...Object.fromEntries(WIRE.map((name) => [name, aspect(name)])), ...overrides };
}

describe("parseSentimentAspects", () => {
  it("reads every aspect under its own name, with every label's probability in order", () => {
    const parsed = parseSentimentAspects(wire());
    expect(parsed).toEqual({
      feeling: aspect("feeling"),
      gesture: aspect("gesture"),
      negativeReason: aspect("negative_reason"),
      positiveReason: aspect("positive_reason"),
      repeat: aspect("repeat"),
      redoRequested: aspect("redo_requested"),
      taskDone: aspect("task_done"),
      intensity: aspect("intensity"),
    });
  });

  it("is null without aspects", () => {
    expect(parseSentimentAspects(undefined)).toBeNull();
    expect(parseSentimentAspects(null)).toBeNull();
    expect(parseSentimentAspects([])).toBeNull();
    expect(parseSentimentAspects("aspects")).toBeNull();
  });

  it.each(WIRE)("is null when %s is missing", (name) => {
    const raw = wire();
    delete (raw as Record<string, unknown>)[name];
    expect(parseSentimentAspects(raw)).toBeNull();
  });

  it.each([
    ["no answer", { probabilities: [] }],
    ["an answer that is not text", { answer: 3, probabilities: [] }],
    ["no probabilities", { answer: "yes" }],
    ["probabilities that are not a list", { answer: "yes", probabilities: { yes: 1 } }],
    ["a label that is not text", { answer: "yes", probabilities: [{ label: 1, probability: 1 }] }],
    ["a probability that is not a number", { answer: "yes", probabilities: [{ label: "yes", probability: "1" }] }],
    ["an aspect that is not an object", "yes"],
  ])("is null when an aspect has %s", (_why, bad) => {
    expect(parseSentimentAspects(wire({ repeat: bad }))).toBeNull();
  });

  it("keeps an aspect with no probabilities", () => {
    expect(parseSentimentAspects(wire({ repeat: { answer: "no", probabilities: [] } }))?.repeat).toEqual({
      answer: "no",
      probabilities: [],
    });
  });
});
