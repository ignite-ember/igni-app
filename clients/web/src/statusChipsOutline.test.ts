/**
 * A header status (the watcher, an extension's) reads as a chip: an
 * outlined pill, unlike the bare bell, folder and terminal buttons.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "theme.css"), "utf8");

/** The declarations of the rule whose selector is exactly ``selector``. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

describe("the header's status chips", () => {
  for (const selector of [".chip-status", ".header-status-chips > .btn"]) {
    it(`outline ${selector}`, () => {
      const decls = rule(selector);
      expect(decls).toMatch(/border:\s*1px solid var\(--border-soft\)/);
      expect(decls).not.toMatch(/border-color:\s*transparent/);
    });
  }
});
