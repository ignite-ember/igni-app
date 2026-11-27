/**
 * Every page scrolls and fades one way, through `FadeScroll`.
 *
 * The owner's rule: "every page should fade the same way", and a page's
 * header row (title, tabs, search, filter, sort, actions) does not scroll —
 * only the content does, dissolving under it like the chat's messages
 * under the app header. So nobody has to look at pages one by one, these
 * pin it from the file system and the stylesheet:
 *
 * (a) every page module renders through `PageShell` (directly or via
 *     `Drawer`), and the set of page modules is discovered, not listed;
 * (b) nothing a page renders scrolls vertically except FadeScroll's
 *     scroller;
 * (c) the header row exists only in `PageShell`, which hands it to
 *     FadeScroll as fixed chrome (the rendered side is in
 *     `FadeScroll.test.tsx`);
 * (d) the chat and FadeScroll share one fade and one blur.
 *
 * Exemptions are explicit, with a reason each, and an exemption that no
 * longer matches anything fails. Each check also runs once against a
 * deliberate violation, so a check that silently matches nothing fails too.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const CSS = read("theme.css").replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  selectors: string[];
  body: string;
}

/** Innermost ``selector { body }`` blocks, comments stripped. */
function parseRules(css: string): Rule[] {
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({
    selectors: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")),
    body: m[2],
  }));
}
const RULES = parseRules(CSS);

// ── (a) the page modules ────────────────────────────────────────────────

/** Where page modules live, and what a page module's file is called. */
const PAGE_PLACES: { dir: string; name: RegExp }[] = [
  { dir: "components/pages", name: /\.tsx$/ },
  { dir: "components/panels", name: /Panel\.tsx$/ },
  { dir: "extensions", name: /PageHost\.tsx$/ },
];

/** Named like a page, and not one. */
const NOT_PAGES: Record<string, string> = {
  "components/panels/LoginPanel.tsx": "the sign-in dialog, drawn by LoginDialog as a modal",
  "components/panels/InfoPanel.tsx": "a modal text panel with no page route",
};

function discoverPages(): string[] {
  return PAGE_PLACES.flatMap(({ dir, name }) =>
    readdirSync(path.join(SRC, dir))
      .filter((f) => name.test(f) && !f.includes(".test."))
      .map((f) => `${dir}/${f}`),
  ).filter((f) => !(f in NOT_PAGES));
}

/** The page frame a module renders through, or `null` if it bypasses it. */
function pageFrame(source: string): "PageShell" | "Drawer" | null {
  if (/<PageShell\b/.test(source)) return "PageShell";
  if (/<Drawer\b/.test(source)) return "Drawer";
  return null;
}

const PAGES = discoverPages();
const APP_PAGES = read("components/AppPages.tsx");

/** What AppPages imports from where pages live. */
const MOUNTED = Array.from(
  APP_PAGES.matchAll(/^import\s+\{[^}]*\}\s+from\s+"(\.\.?\/[^"]+)";/gm),
  (m) => path.posix.normalize(path.posix.join("components", m[1])) + ".tsx",
).filter((f) => PAGE_PLACES.some(({ dir, name }) => f.startsWith(`${dir}/`) && name.test(f)));

describe("(a) every page renders through PageShell", () => {
  it("discovers the pages from the file system", () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(14);
    expect(PAGES).toContain("components/panels/PluginsPanel.tsx");
    expect(PAGES).toContain("extensions/ExtensionPageHost.tsx");
  });

  it.each(PAGES)("%s renders through PageShell or Drawer", (file) => {
    expect(pageFrame(read(file))).not.toBeNull();
  });

  it("mounts every discovered page, and mounts nothing undiscovered", () => {
    expect([...MOUNTED].sort()).toEqual([...PAGES].sort());
  });

  it("renders every page under the PageContext that makes a Drawer a page", () => {
    expect(APP_PAGES).toMatch(/<PageContext\.Provider\b/);
  });

  it("Drawer renders PageShell as a page", () => {
    expect(pageFrame(read("components/panels/Drawer.tsx"))).toBe("PageShell");
  });

  it.each(Object.entries(NOT_PAGES))("exemption %s is not stale (%s)", (file) => {
    expect(existsSync(path.join(SRC, file))).toBe(true);
    expect(MOUNTED).not.toContain(file);
  });

  it("catches a page that bypasses PageShell", () => {
    const bypass = `function RogueItem() {
      return <section className="page"><div className="page-body">x</div></section>;
    }`;
    expect(pageFrame(bypass)).toBeNull();
  });
});

// ── (b) one vertical scroller ───────────────────────────────────────────

/** Resolve a relative import to a source file, or `null`. */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (existsSync(path.join(SRC, base + ext))) return base + ext;
  }
  return null;
}

/** Every component a page can render: the pages and what they import,
 *  transitively, inside components/ and extensions/. */
function pageRendered(): string[] {
  const seen = new Set<string>();
  const stack = [...PAGES, "components/PageShell.tsx"];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of read(file).matchAll(/^\s*(?:import|export)(?!\s+type\b)[^'"]*?from\s+"([^"]+)"/gm)) {
      const next = resolveImport(file, m[1]);
      if (next && !next.includes(".test.") && /^(components|extensions)\//.test(next)) stack.push(next);
    }
  }
  return [...seen];
}

/** The class names these sources put on elements: every word in the
 *  string literals of each ``className=`` value (a literal, or an
 *  expression — a template, a ternary — read to its closing brace). */
function classTokens(sources: string[]): Set<string> {
  const out = new Set<string>();
  const words = (text: string) => {
    for (const m of text.matchAll(/["'`]([^"'`\n]{1,300})["'`]/g)) {
      for (const w of m[1].replace(/\$\{[^}]*\}/g, " ").match(/[a-z][a-z0-9-]*/g) ?? []) out.add(w);
    }
  };
  for (const src of sources) {
    for (const m of src.matchAll(/className=/g)) {
      let i = m.index + m[0].length;
      if (src[i] !== "{") {
        words(src.slice(i, src.indexOf(src[i], i + 1) + 1));
        continue;
      }
      let depth = 0;
      const start = i;
      for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) break;
      }
      words(src.slice(start, i));
    }
  }
  return out;
}

/** Does this declaration body let the box scroll vertically? */
function scrollsVertically(body: string): boolean {
  const y = body.match(/(?:^|[;\s])overflow-y\s*:\s*([^;]+)/);
  if (y) return /\b(auto|scroll)\b/.test(y[1]);
  const both = body.match(/(?:^|[;\s])overflow\s*:\s*([^;]+)/);
  if (!both) return false;
  const parts = both[1].trim().split(/\s+/);
  return /^(auto|scroll)$/.test(parts[1] ?? parts[0]);
}

/** Selectors whose subject is a page-rendered class and that scroll
 *  vertically, keyed by that class. */
function verticalScrollers(rules: Rule[], tokens: Set<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rules) {
    if (!scrollsVertically(r.body)) continue;
    for (const sel of r.selectors) {
      const subject = sel.split(/[\s>+~]+/).pop() ?? "";
      for (const cls of subject.match(/\.([\w-]+)/g) ?? []) {
        const name = cls.slice(1);
        if (!tokens.has(name)) continue;
        out.set(name, [...(out.get(name) ?? []), sel]);
      }
    }
  }
  return out;
}

/** The one scroller every page goes through. */
const THE_SCROLLER = "fade-scroll-body";

/** Page-rendered boxes that may scroll, and why. */
const SCROLL_EXEMPT: Record<string, string> = {
  "drawer-body": "the modal frame's body, drawn only when a Drawer is not a page",
  "control-menu": "a popup menu floating over the page, not page content",
  "watcher-log": "a live log tail pinned to its newest line: a viewport onto a stream",
};

/** Inline vertical scrolling in a component's own style props. */
const INLINE_SCROLL = /overflow(Y)?\s*:\s*["'](auto|scroll)/;

const RENDERED = pageRendered();
const TOKENS = classTokens(RENDERED.map(read));
const SCROLLERS = verticalScrollers(RULES, TOKENS);

describe("(b) nothing on a page scrolls vertically but FadeScroll", () => {
  it("collects what pages render", () => {
    expect(RENDERED).toContain("components/page/FadeScroll.tsx");
    expect(TOKENS.has(THE_SCROLLER)).toBe(true);
  });

  it("finds FadeScroll's scroller among the scrollers", () => {
    expect(SCROLLERS.has(THE_SCROLLER)).toBe(true);
  });

  it("has no other vertical scroller", () => {
    const others = [...SCROLLERS.keys()].filter((c) => c !== THE_SCROLLER && !(c in SCROLL_EXEMPT));
    expect(others.map((c) => `${c}: ${SCROLLERS.get(c)!.join(", ")}`)).toEqual([]);
  });

  it.each(Object.entries(SCROLL_EXEMPT))("exemption .%s is not stale (%s)", (cls) => {
    expect(SCROLLERS.has(cls)).toBe(true);
  });

  it.each(RENDERED)("%s sets no inline vertical scroll", (file) => {
    expect(read(file)).not.toMatch(INLINE_SCROLL);
  });

  it("catches a page with its own scroller", () => {
    const rogue = parseRules(".rogue-list { max-height: 400px; overflow-y: auto; }");
    expect([...verticalScrollers(rogue, new Set(["rogue-list"])).keys()]).toEqual(["rogue-list"]);
    const shorthand = parseRules(".rogue-pane .rogue-list { overflow: hidden auto; }");
    expect([...verticalScrollers(shorthand, new Set(["rogue-list"])).keys()]).toEqual(["rogue-list"]);
    // Horizontal-only is fine: a tab rail, a wide table.
    const rail = parseRules(".rogue-rail { overflow-x: auto; }");
    expect(verticalScrollers(rail, new Set(["rogue-rail"])).size).toBe(0);
    expect(`<div style={{ overflowY: "auto" }} />`).toMatch(INLINE_SCROLL);
  });
});

// ── (c) the header row is fixed chrome ──────────────────────────────────

/** Sources that spell the header row's classes. */
function headerRowSpellers(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([, src]) => /["'`\s]page-(head|toolbar)(?![\w-])/.test(src))
    .map(([f]) => f);
}

describe("(c) the header row stays put", () => {
  it("is drawn only by PageShell, which hands it to FadeScroll as chrome", () => {
    const files = Object.fromEntries(RENDERED.map((f) => [f, read(f)]));
    expect(headerRowSpellers(files)).toEqual(["components/PageShell.tsx"]);
    expect(read("components/PageShell.tsx")).toMatch(/<FadeScroll\s+chrome=\{chrome\}/);
  });

  it("catches a page that draws its own header row", () => {
    expect(headerRowSpellers({ "Rogue.tsx": `<div className="page-head">x</div>` })).toEqual(["Rogue.tsx"]);
    expect(headerRowSpellers({ "Fine.tsx": `<div className="page-head-extras">x</div>` })).toEqual([]);
  });

  const body = (sel: string) => RULES.filter((r) => r.selectors.includes(sel)).map((r) => r.body).join("\n");

  it("lets the scroller reach under the chrome and the app header", () => {
    const scroller = body(".fade-scroll-body");
    expect(scroller).toMatch(
      /margin-top:\s*calc\(-1 \* \(var\(--page-under-header, 0px\) \+ var\(--fade-chrome-h, 0px\)\)\)/,
    );
    expect(scroller).toMatch(/padding-top:\s*calc\(var\(--page-under-header, 0px\) \+ var\(--fade-chrome-h, 0px\)\)/);
    expect(body(".main--paged .page")).toMatch(/--page-under-header:\s*58px/);
  });

  it("stacks the chrome over the blur over the content", () => {
    const z = (sel: string) => Number(body(sel).match(/z-index:\s*(-?\d+)/)?.[1]);
    expect(z(".fade-scroll-chrome")).toBeGreaterThan(z(".fade-scroll-blur"));
    expect(z(".fade-scroll-blur")).toBeGreaterThan(z(".fade-scroll-body"));
    expect(body(".fade-scroll-chrome")).not.toMatch(/background/);
  });

  it("keeps no rule keyed on the header row inside the scroller", () => {
    expect(CSS).not.toMatch(/\.page-body\s*>\s*\.page-(head|toolbar)/);
    expect(CSS).not.toMatch(/\.page\s*>\s*\.page-(head|toolbar)/);
  });
});

// ── (d) one fade, one blur ──────────────────────────────────────────────

const SCROLLED = ".fade-scroll[data-scrolled] > .fade-scroll-body";

/** Rules other than the two shared ones that restyle the fade or blur
 *  of the chat, a page's scroller, or either blur layer. */
function fadeOverrides(rules: Rule[]): string[] {
  const subjects = /(\.conversation|\.fade-scroll-body|\.page-body|\.app-header-blur|\.fade-scroll-blur)(\[[^\]]*\])?$/;
  const shared = (r: Rule) =>
    (r.selectors.includes(".conversation") && r.selectors.includes(SCROLLED)) ||
    (r.selectors.includes(".app-header-blur") && r.selectors.includes(".fade-scroll-blur"));
  return rules
    .filter((r) => !shared(r) && /mask|backdrop-filter|background\s*:/.test(r.body))
    .flatMap((r) => r.selectors.filter((s) => subjects.test(s)));
}

describe("(d) the chat and FadeScroll share one fade and one blur", () => {
  it("defines the fade curve once", () => {
    expect(CSS.match(/--top-fade-mask\s*:/g)).toHaveLength(1);
    // The curve's last stop, written anywhere else, is a second copy.
    expect(CSS.match(/#000 76px/g)).toHaveLength(1);
  });

  it("applies it in one rule to the chat and to a scrolled page", () => {
    const shared = RULES.filter((r) => r.selectors.includes(".conversation") && r.selectors.includes(SCROLLED));
    expect(shared).toHaveLength(1);
    expect(shared[0].body).toMatch(/(^|[^-])mask-image:\s*var\(--top-fade-mask\)/);
    expect(shared[0].body).toMatch(/-webkit-mask-image:\s*var\(--top-fade-mask\)/);
  });

  it("defines the blur once and applies it in one rule to both", () => {
    expect(CSS.match(/--top-blur\s*:/g)).toHaveLength(1);
    expect(CSS.match(/--top-blur-mask\s*:/g)).toHaveLength(1);
    expect(CSS.match(/blur\(6px\)/g)).toHaveLength(1);
    const shared = RULES.filter(
      (r) => r.selectors.includes(".app-header-blur") && r.selectors.includes(".fade-scroll-blur"),
    );
    expect(shared).toHaveLength(1);
    expect(shared[0].body).toMatch(/(^|[^-])backdrop-filter:\s*var\(--top-blur\)/);
    expect(shared[0].body).toMatch(/(^|[^-])mask-image:\s*var\(--top-blur-mask\)/);
  });

  it("is not overridden for any of them", () => {
    expect(fadeOverrides(RULES)).toEqual([]);
  });

  it("catches a page with its own fade or blur", () => {
    const rogue = parseRules(`.conversation, ${SCROLLED} { mask-image: var(--top-fade-mask); }
      .page:has(.rogue) .page-body { mask-image: linear-gradient(transparent, #000); }
      .main--paged .fade-scroll-blur { backdrop-filter: none; }`);
    expect(fadeOverrides(rogue)).toEqual([".page:has(.rogue) .page-body", ".main--paged .fade-scroll-blur"]);
  });
});

describe("the page scroller's native scrollbar", () => {
  it("is hidden, because it would fade with the content; the thumb is drawn over the fade", () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../theme.css"), "utf8").replace(/\r\n/g, "\n");
    expect(css).toMatch(/\.fade-scroll-body \{[^}]*scrollbar-width: none;/);
    expect(css).toMatch(/\.fade-scroll-body::-webkit-scrollbar \{\s*display: none;/);
  });
});

