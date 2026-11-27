/**
 * A page's top edge is the chat's top edge.
 *
 * Pages used to sit under a flat opaque bar that cut the list off at a
 * line, while the chat's messages dissolve at the top of the window. The
 * owner asked for one look, so these pin that both use the same curve
 * from one definition, that the bar is gone, and that the rules keyed
 * on the title row still find it now that it lives inside the scroller.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const CSS = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../theme.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selectors: string[];
  body: string;
}

/** Innermost ``selector { body }`` blocks, comments stripped. */
const RULES: Rule[] = Array.from(CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({
  selectors: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")),
  body: m[2],
}));

const rulesFor = (selector: string) => RULES.filter((r) => r.selectors.includes(selector));

describe("the top fade", () => {
  it("is defined once", () => {
    expect(CSS.match(/--top-fade-mask\s*:/g)).toHaveLength(1);
    // The curve's last stop, written anywhere else, is a second copy.
    expect(CSS.match(/#000 76px/g)).toHaveLength(1);
  });

  it("is one rule for the chat and for a scrolled page", () => {
    const shared = RULES.filter(
      (r) => r.selectors.includes(".conversation") && r.selectors.includes(".page-body[data-scrolled]"),
    );
    expect(shared).toHaveLength(1);
    expect(shared[0].body).toMatch(/(^|[^-])mask-image:\s*var\(--top-fade-mask\)/);
    expect(shared[0].body).toMatch(/-webkit-mask-image:\s*var\(--top-fade-mask\)/);
  });

  it("is not overridden for either of them", () => {
    for (const r of RULES) {
      if (!r.selectors.some((s) => /\.conversation$|\.page-body(\[|$)/.test(s))) continue;
      if (r.selectors.includes(".conversation") && r.selectors.includes(".page-body[data-scrolled]")) continue;
      expect(r.body, r.selectors.join(", ")).not.toMatch(/mask/);
    }
  });
});

describe("the header over a page", () => {
  it("keeps the chat's blur, not a flat bar", () => {
    for (const r of rulesFor(".main--paged .app-header-blur")) {
      expect(r.body).not.toMatch(/background\s*:/);
      expect(r.body).not.toMatch(/backdrop-filter\s*:\s*none/);
      expect(r.body).not.toMatch(/mask-image\s*:\s*none/);
      expect(r.body).not.toMatch(/height\s*:/);
    }
  });

  it("lets the page's scroller reach the top of the window", () => {
    const body = rulesFor(".page-body").map((r) => r.body).join("\n");
    expect(body).toMatch(/margin-top:\s*calc\(-1 \* var\(--page-under-header, 0px\)\)/);
    expect(body).toMatch(/padding-top:\s*var\(--page-under-header, 0px\)/);
    const paged = rulesFor(".main--paged .page").map((r) => r.body).join("\n");
    expect(paged).toMatch(/--page-under-header:\s*58px/);
  });
});

describe("rules keyed on the title row", () => {
  it("look for it inside the scroller, where it now lives", () => {
    // ``.page > .page-head`` matches nothing any more; a rule still
    // written that way silently stops applying.
    expect(CSS).not.toMatch(/\.page(:has\(\.files-layout\))?\s*>\s*\.page-(head|toolbar)/);
    expect(CSS).not.toMatch(/:has\(>\s*\.page-head\)/);
    expect(CSS).toMatch(/\.page:has\(> \.page-body > \.page-head\)/);
    expect(CSS).toMatch(/\.page:not\(:has\(> \.page-body > \.page-head\)\) > \.page-crumbs/);
  });
});
