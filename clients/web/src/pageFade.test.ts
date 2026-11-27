/**
 * A page's content fades out under its title, like the chat under the header.
 *
 * The page's scroll box used to clip its content at a hard top edge, so a
 * card scrolling up was cut at a line while the chat faded out.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "theme.css"), "utf8");

/** The declarations of every rule whose selector is exactly ``selector``, joined. */
function rules(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm"))].map((m) => m[1]).join("\n");
}

describe("page fade", () => {
  it("masks the page's scroll box from transparent to opaque over --page-fade", () => {
    const body = rules(".page-body");
    for (const prop of ["-webkit-mask-image", "mask-image"]) {
      expect(body).toMatch(new RegExp(`(^|\\s)${prop}: linear-gradient\\(\\s*to bottom,\\s*transparent 0px,[^;]*#000 var\\(--page-fade\\)`));
    }
  });

  it("ends the fade within the air above the first item, so nothing at rest is faded", () => {
    const fade = (sel: string) => Number(rules(sel).match(/--page-fade: (\d+)px/)?.[1]);
    const measureTop = Number(rules(".page-measure").match(/padding: (\d+)px/)?.[1]);
    const underTitle = rules(".page-head + .page-body");
    const slid = Number(underTitle.match(/padding-top: (\d+)px/)?.[1]);
    expect(fade(".page-body")).toBeLessThanOrEqual(measureTop);
    expect(underTitle).toContain(`margin-top: -${slid}px`);
    expect(fade(".page-head + .page-body")).toBeLessThanOrEqual(measureTop + slid);
  });

  it("adds the chat's soft blur in a sticky strip that takes no clicks and no space", () => {
    const strip = rules(".page-body::before");
    expect(strip).toContain("position: sticky");
    expect(strip).toContain("backdrop-filter: blur(6px)");
    expect(strip).toContain("pointer-events: none");
    expect(strip).toContain("margin-bottom: calc(var(--page-fade) * -1)");
  });
});
