/**
 * The open-files tab strip scrolls sideways only, on rails.
 *
 * With ``overflow-x: auto`` alone, ``overflow-y`` computes to ``auto`` as
 * well, and a trackpad swipe across the tabs dragged the strip up and
 * down. Every rule that styles the strip must keep it that way.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "theme.css"), "utf8");

/** The declarations of every rule whose selector ends in ``.files-tabs``. */
function stripRules(): string[] {
  return [...CSS.matchAll(/([^{}]*\.files-tabs)\s*\{([^}]*)\}/g)].map((m) => m[2]);
}

describe("the open-files tab strip", () => {
  it("scrolls sideways, never up and down", () => {
    const base = stripRules()[0];
    expect(base).toMatch(/overflow-x:\s*auto/);
    expect(base).toMatch(/overflow-y:\s*hidden/);
    expect(base).toMatch(/overscroll-behavior:\s*contain/);
    expect(base).toMatch(/touch-action:\s*pan-x/);
  });

  it("is not given vertical scrolling back by a later rule", () => {
    for (const rule of stripRules()) {
      expect(rule).not.toMatch(/overflow(-y)?:\s*(auto|scroll|visible)/);
    }
  });
});
