/**
 * The context ring's arc is coloured by its tone.
 *
 * The rules once targeted ``.ctx-ring.tone-*``, a class no element carries,
 * so the arc had no stroke and the ring looked empty at any fill.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "theme.css"), "utf8");

/** The declarations of the first rule whose selector is exactly ``selector``. */
function rule(selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"))?.[1];
}

describe("context ring colour", () => {
  it.each([
    ["ok", "--success"],
    ["warn", "--warning"],
    ["danger", "--danger"],
  ])("tone-%s strokes the arc with %s", (tone, token) => {
    expect(rule(`.session-ctx.tone-${tone} .ctx-ring-fill`)).toContain(`stroke: var(${token})`);
  });

  it("no rule targets the class nothing carries", () => {
    expect(css).not.toMatch(/\.ctx-ring\.tone-/);
  });

  it("the track stays visible on the hovered button's raised background", () => {
    expect(rule(".ctx-ring-track")).not.toContain("var(--bg-raised)");
  });
});
