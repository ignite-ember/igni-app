/**
 * The header's bell, folder and terminal read as one set.
 *
 * The bell borrows the menus' glyph, which ``.menu-icon`` draws quieter
 * than its label (thinner, 72% opacity); in the header it showed a
 * lighter grey than the folder and terminal beside it.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "theme.css"), "utf8");

function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  return CSS.slice(at, CSS.indexOf("}", at));
}

describe("the header's bell", () => {
  it("is drawn at the folder and terminal's full strength and weight", () => {
    const bell = rule(".chip-bell .menu-icon");
    expect(bell).toMatch(/opacity:\s*1;/);
    expect(bell).toMatch(/stroke-width:\s*1\.6;/);
  });
});
