/**
 * Every page draws its buttons with the shared {@link Button} and its
 * cards with the one {@link EntityCard} look.
 *
 * The pages used to carry three button styles at once — the orange
 * gradient pill, the bordered `.btn`, the boxed `.kb-icon-btn` — and each
 * card page added its own card rules on top of the shared card, so Agents,
 * Skills and Workflows each looked a little different. These checks keep
 * both from coming back: page sources may not spell the old classes, and
 * the stylesheet may not restyle the shared card from a page's own class.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const COMPONENTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS = readFileSync(path.join(COMPONENTS, "../theme.css"), "utf8");

/** Page sources: the kit, the pages, and the panels drawn as pages. */
const PAGE_DIRS = ["page", "pages", "panels"];
/** Not pages: modal dialogs, the frame's own chrome, the file browser. */
const NOT_PAGES = new Set([
  "panels/DirectoryPicker.tsx",
  "panels/LoginPanel.tsx",
  "panels/Drawer.tsx",
]);
const NOT_PAGE_DIRS = ["pages/files/"];
/** Pages still to move over; each entry must still need it. */
const PENDING = new Set<string>([
  "panels/LoopPanel.tsx",
  "panels/ProgramsPanel.tsx",
  "panels/SchedulePanel.tsx",
  "panels/SkillsPanel.tsx",
  "panels/watcher/WatcherRow.tsx",
  "panels/watcher/WatcherTail.tsx",
  "pages/ContextPage.tsx",
]);

/** The old styles, and the SDK's Button (which draws `.btn`). */
const OLD = [
  /className=["'{`][^"'}`]*\bbtn\b/,
  /\bbtn-(primary|sm|danger|xs|quiet|warn)\b/,
  /\bkb-icon-btn\b/,
  /\bplugins-add\b(?!-)/,
  /import\s*\{[^}]*\bButton\b[^}]*\}\s*from\s*"@ignite-ember\/ui-react"/,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sources = PAGE_DIRS.flatMap((d) => walk(path.join(COMPONENTS, d)))
  .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
  .map((f) => path.relative(COMPONENTS, f).split(path.sep).join("/"))
  .filter((f) => !NOT_PAGES.has(f) && !NOT_PAGE_DIRS.some((d) => f.startsWith(d)));

function oldStyles(file: string): string[] {
  const text = readFileSync(path.join(COMPONENTS, file), "utf8");
  return OLD.filter((re) => re.test(text)).map(String);
}

describe("page buttons are the shared Button", () => {
  it("finds the page sources", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources).toContain("panels/McpPanel.tsx");
  });

  it.each(sources.filter((f) => !PENDING.has(f)))("%s spells no old button class", (file) => {
    expect(oldStyles(file)).toEqual([]);
  });

  it.each([...PENDING])("%s is still pending (drop it from the list once moved)", (file) => {
    expect(oldStyles(file).length).toBeGreaterThan(0);
  });
});

/** Every rule as [selector list, body], comments stripped. */
function rules(): [string, string][] {
  const out: [string, string][] = [];
  const text = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([m[1].trim(), m[2]]);
  return out;
}

describe("the stylesheet draws one button and one card", () => {
  const all = rules();
  const body = (sel: string) => all.find(([s]) => s === sel)?.[1] ?? "";

  it("primary is the page's inverse fill, with no gradient and no border", () => {
    const primary = body(".button.button--primary");
    expect(primary).toMatch(/background:\s*var\(--fg\)/);
    expect(primary).toMatch(/color:\s*var\(--bg\)/);
    const base = body(".button");
    expect(base).toMatch(/border:\s*none/);
    expect(base).toMatch(/border-radius:\s*10px/);
    expect(base).toMatch(/height:\s*32px/);
    for (const [sel, b] of all.filter(([s]) => /\.button(--|\b)/.test(s))) {
      expect(b, sel).not.toMatch(/gradient/);
      expect(b, sel).not.toMatch(/border:\s*1px/);
    }
  });

  it("no page surface restyles the old button classes", () => {
    const surfaces = /\.(entity-hero|entity-card|page-controls|detail-section|page-empty)[\w-]*/;
    const offenders = all
      .flatMap(([sel]) => sel.split(","))
      .map((s) => s.trim())
      .filter((s) => surfaces.test(s) && /\.(btn|kb-icon-btn)\b/.test(s));
    expect(offenders).toEqual([]);
  });

  it("no page restyles the shared card from a class of its own", () => {
    const offenders = all
      .flatMap(([sel]) => sel.split(","))
      .map((s) => s.trim())
      .filter((s) => s.includes("entity-card"))
      .filter((s) => {
        const first = s.split(/[\s>+~]+/)[0];
        return !first.startsWith(".entity-card") || /\.entity-card[\w-]*\.(?!entity-card|is-)/.test(s);
      });
    expect(offenders).toEqual([]);
  });
});
