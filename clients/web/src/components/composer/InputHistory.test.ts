import { describe, expect, it } from "vitest";

import { HISTORY_LIMIT, InputHistory } from "./InputHistory";

const sent = (...wires: string[]) => wires.reduce((h, w) => h.push(w), InputHistory.empty());

describe("InputHistory", () => {
  it("nothing sent, nothing to recall", () => {
    expect(InputHistory.empty().prev("typing")).toBeNull();
    expect(InputHistory.empty().next()).toBeNull();
  });

  it("walks back from the newest, and stops at the oldest", () => {
    const a = sent("one", "$ two").prev("draft")!;
    expect(a.entry).toBe("$ two");
    const b = a.history.prev("ignored")!;
    expect(b.entry).toBe("one");
    expect(b.history.prev("ignored")!.entry).toBe("one");
  });

  it("walks forward and gives the draft back past the newest", () => {
    const back = sent("one", "two").prev("half-written")!.history.prev("")!.history;

    const fwd = back.next()!;
    expect(fwd.entry).toBe("two");
    const out = fwd.history.next()!;
    expect(out.entry).toBe("half-written");
    expect(out.history.browsing).toBe(false);
    expect(out.history.next()).toBeNull();
  });

  it("does not repeat the newest entry", () => {
    expect(sent("again", "again").size).toBe(1);
    expect(sent("a", "b", "a").size).toBe(3);
  });

  it("keeps the newest entries up to the limit", () => {
    const h = sent(...Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => `m${i}`));

    expect(h.size).toBe(HISTORY_LIMIT);
    expect(h.prev("")!.entry).toBe(`m${HISTORY_LIMIT + 4}`);
  });

  it("reset stops browsing, and is the same history when not browsing", () => {
    const h = sent("one");
    expect(h.reset()).toBe(h);

    const browsing = h.prev("")!.history;
    expect(browsing.reset().browsing).toBe(false);
  });

  it("sending stops browsing", () => {
    expect(sent("one").prev("")!.history.push("two").browsing).toBe(false);
  });
});
