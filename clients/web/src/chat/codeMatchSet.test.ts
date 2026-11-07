import { describe, expect, it } from "vitest";

import type { CodeMatch } from "../protocol/composerWire";
import { CodeMatchSet } from "./codeMatchSet";

const at = (path: string, line: number, end_line?: number): CodeMatch => ({
  path,
  line,
  end_line,
  preview: "",
});

describe("CodeMatchSet", () => {
  it("nothing matched is no set", () => {
    expect(CodeMatchSet.of([])).toBeNull();
  });

  it("merges adjacent and overlapping ranges of the first file", () => {
    const set = CodeMatchSet.of([at("a.py", 9, 11), at("a.py", 12), at("a.py", 10, 14), at("a.py", 20)])!;

    expect(set.ranges).toEqual([
      [9, 14],
      [20, 20],
    ]);
    expect(set.anchor).toBe(9);
  });

  it("sorts before merging", () => {
    const set = CodeMatchSet.of([at("a.py", 30), at("a.py", 5, 6)])!;

    expect(set.lineSpec).toBe("5-6,30");
    expect(set.anchor).toBe(5);
  });

  it("an older backend without end_line gives single-line ranges", () => {
    expect(CodeMatchSet.of([at("a.py", 7)])!.lineSpec).toBe("7");
  });

  it("an end_line before the start is read as the start", () => {
    expect(CodeMatchSet.of([at("a.py", 7, 3)])!.lineSpec).toBe("7");
  });

  it("anchors on the first file and counts the others", () => {
    const set = CodeMatchSet.of([at("src/hello.py", 9, 11), at("b.py", 1), at("c.py", 1), at("b.py", 4)])!;

    expect(set.firstPath).toBe("src/hello.py");
    expect(set.extraFiles).toBe(2);
    expect(set.label()).toBe("hello.py 9-11 +2");
  });

  it("separates ranges with ', ' on the pill and ',' on the wire", () => {
    const set = CodeMatchSet.of([at("src/hello.py", 9, 16), at("src/hello.py", 20)])!;

    expect(set.label()).toBe("hello.py 9-16, 20");
    expect(set.lineSpec).toBe("9-16,20");
  });
});
