/**
 * The whole app draws its buttons with the shared {@link Button} kit.
 *
 * `pageButtons.test.ts` keeps the pages on the kit; this check covers
 * every other component — the chat's banners and cards, the dialogs,
 * the sidebar, the extension chrome — so the old bordered `.btn` and the
 * orange gradient primary cannot creep back anywhere. The `.btn` rules
 * stay in the stylesheet only because an extension's SDK `Button`
 * renders them, and they are drawn like the kit; that is checked here
 * too.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS = readFileSync(path.join(SRC, "theme.css"), "utf8");

/** Where component sources live. `components/page/` is the kit itself. */
const ROOTS = ["components", "extensions"];
const KIT = "components/page/";

/** A `btn` class token (not `send-btn`, `plan-card-btn--approve`, …). */
const OLD = [
  /className=\{?["'`][^"'`]*(?<![\w-])btn(?![\w-])/,
  /(?<![\w-])btn btn-/,
  /(?<![\w-])btn-(primary|danger|sm|xs|quiet|warn)(?![\w-])/,
];
/** The SDK's Button draws `.btn`; only the extension bridge may use it. */
const SDK_BUTTON = /import\s*\{[^}]*\bButton\b[^}]*\}\s*from\s*"@ignite-ember\/ui-react"/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sources = ROOTS.flatMap((d) => walk(path.join(SRC, d)))
  .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
  .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
  .filter((f) => !f.startsWith(KIT));

const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");

describe("every component button is the shared Button", () => {
  it("finds the component sources", () => {
    expect(sources).toContain("components/chatItems/InterruptedBanner.tsx");
    expect(sources).toContain("components/HitlDialog.tsx");
    expect(sources).toContain("extensions/ExtensionIndicator.tsx");
    expect(sources.length).toBeGreaterThan(100);
  });

  it("the pattern catches the old spellings and nothing else", () => {
    const hit = (line: string) => OLD.some((re) => re.test(line));
    expect(hit('className="btn"')).toBe(true);
    expect(hit('className="btn btn-sm btn-primary"')).toBe(true);
    expect(hit('className={b.primary ? "btn btn-primary" : "btn"}')).toBe(true);
    expect(hit('className="btn sidebar-new-chat"')).toBe(true);
    expect(hit('className="send-btn stop"')).toBe(false);
    expect(hit('className="plan-card-btn plan-card-btn--approve"')).toBe(false);
    expect(hit('className="kb-icon-btn"')).toBe(false);
  });

  it.each(sources)("%s spells no old button class", (file) => {
    const text = read(file);
    expect(OLD.filter((re) => re.test(text)).map(String)).toEqual([]);
  });

  it.each(sources.filter((f) => f.startsWith("components/")))(
    "%s does not draw the SDK's .btn Button",
    (file) => {
      expect(SDK_BUTTON.test(read(file))).toBe(false);
    },
  );
});

describe("the legacy .btn rules are drawn like the kit", () => {
  const rules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (m) => [m[1].trim(), m[2]] as const,
  );
  const body = (sel: string) => rules.find(([s]) => s === sel)?.[1] ?? "";

  // An extension's status in the header is an outlined chip, like igni's own.
  const OUTLINED_CHIPS = new Set([".header-status-chips > .btn", ".header-status-chips > .btn:hover"]);

  it("no .btn rule carries a gradient or a border", () => {
    const legacy = rules.filter(([s]) => /(?<![\w-])\.btn(?![\w-])|(?<![\w-])\.btn-/.test(s));
    expect(legacy.length).toBeGreaterThan(5);
    for (const [sel, b] of legacy) {
      expect(b, sel).not.toMatch(/gradient/);
      if (OUTLINED_CHIPS.has(sel)) continue;
      expect(b, sel).not.toMatch(/border(-color)?:\s*(1px|var|color-mix)/);
    }
  });

  it("matches the kit's shape and fills", () => {
    expect(body(".btn")).toMatch(/border:\s*none/);
    expect(body(".btn")).toMatch(/border-radius:\s*10px/);
    expect(body(".btn")).toMatch(/height:\s*32px/);
    expect(body(".btn.btn-primary")).toMatch(/background:\s*var\(--fg\)/);
    expect(body(".btn.btn-primary")).toMatch(/color:\s*var\(--bg\)/);
    expect(body(".btn.btn-danger")).toMatch(/color:\s*var\(--danger-text/);
    expect(body(".btn.btn-sm")).toMatch(/height:\s*28px/);
  });
});
