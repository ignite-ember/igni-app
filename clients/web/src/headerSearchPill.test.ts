/**
 * The header's search grows out of the search icon: the pill is anchored
 * at the icon's right edge and stacks over the chips and breadcrumb
 * rather than pushing them along the row.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** LF line endings, so the multi-line selectors match a Windows CRLF checkout too. */
const CSS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "theme.css"), "utf8").replace(/\r\n/g, "\n");

/** The declarations of the rule whose selector is exactly ``selector``. */
function rule(selector: string, css = CSS): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

describe("the header's search pill", () => {
  it("keeps the icon's 30px slot in the row, so opening reflows nothing", () => {
    const slot = rule(".header-search");
    expect(slot).toMatch(/position:\s*relative;/);
    expect(slot).toMatch(/width:\s*30px;/);
    expect(slot).toMatch(/flex:\s*0 0 auto;/);
  });

  it("is absolute, anchored at the icon's right edge, above the chips", () => {
    const pill = rule(".header-search-pill");
    expect(pill).toMatch(/position:\s*absolute;/);
    expect(pill).toMatch(/right:\s*0;/);
    expect(pill).not.toMatch(/\bleft:/);
    expect(pill).toMatch(/z-index:\s*[1-9]/);
    expect(pill).toMatch(/width:\s*30px;/);
    expect(pill).toMatch(/transition:[^;]*\bwidth\b/);
  });

  it("grows leftward up to the sidebar toggle when open", () => {
    const open = rule(".header-search[data-open] .header-search-pill");
    expect(open).toMatch(/width:\s*var\(--header-search-room/);
    // Opaque, so the chips it covers do not show through.
    expect(open).toMatch(/background:\s*var\(--bg\);/);
  });

  it("is a quiet outlined pill, not an orange glow", () => {
    const pill = rule(".header-search-pill");
    expect(pill).toMatch(/border:\s*1px solid var\(--border-soft\)/);
    expect(pill).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    const open = rule(".header-search[data-open] .header-search-pill");
    expect(`${pill}${open}`).not.toMatch(/igni-orange|box-shadow/);
  });

  it("closes to the icon's 30px and opens to a taller 40px field, centred on the row", () => {
    expect(rule(".header-search-pill")).toMatch(/height:\s*30px;/);
    const open = rule(".header-search[data-open] .header-search-pill");
    expect(open).toMatch(/height:\s*40px;/);
    expect(open).toMatch(/top:\s*-5px;/);
    expect(rule(".chat-search-scope-btn")).toMatch(/height:\s*26px;/);
    const nav = rule(".chat-search-nav,\n.chat-search-close");
    expect(nav).toMatch(/height:\s*28px;/);
    expect(rule(".chat-search-input")).toMatch(/font-size:\s*var\(--text-md\)/);
  });

  it("drops its matches under the pill, right-aligned with it", () => {
    const results = rule(".chat-search-results");
    expect(results).toMatch(/position:\s*absolute;/);
    expect(results).toMatch(/top:\s*calc\(100% \+/);
    expect(results).toMatch(/right:\s*0;/);
  });

  it("does not animate under prefers-reduced-motion", () => {
    const at = CSS.indexOf(".header-search-pill,\n  .chat-search-row {");
    expect(at).toBeGreaterThan(0);
    const block = CSS.slice(CSS.lastIndexOf("@media", at), CSS.indexOf("}", at));
    expect(block).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(block).toMatch(/transition:\s*none;/);
    expect(block).toMatch(/animation:\s*none;/);
  });

  it("is not a window drag handle in the desktop app", () => {
    expect(CSS).toMatch(/:root\[data-host="tauri"\] \.app-header \.header-search-pill,/);
  });

  it("leaves none of the old floating bar behind", () => {
    for (const gone of [
      ".chip-search",
      "search-bar-in",
      "search-bar-glow",
      ".chat-search-icon",
      ".chat-search-bar::after",
    ]) {
      expect(CSS, gone).not.toContain(gone);
    }
    expect(rule(".chat-search-bar")).not.toMatch(/position:|top:|transform:/);
  });
});
