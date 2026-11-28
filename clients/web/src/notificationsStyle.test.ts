/**
 * The notifications' look, pinned where a refactor of theme.css could
 * silently lose it: tokens only, the stack in the bottom-right corner
 * clear of the composer, and motion that respects reduced-motion.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const CSS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "theme.css"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule whose selectors all name a notification class. */
function rules(prefix: RegExp): { selector: string; body: string }[] {
  return Array.from(CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({ selector: m[1].trim(), body: m[2] })).filter(
    (r) => r.selector.split(",").every((s) => prefix.test(s)),
  );
}

const OURS = /\.(toast|toasts|notify|ncard)(-[\w-]+)?\b/;
/** The two colour literals these rules kept from before: the backdrop's
 *  dim, which every overlay uses, and nothing else. */
const KEPT = new Set(["rgba(0, 0, 0, 0.28)"]);

describe("the notifications' styles", () => {
  it("use tokens, not colour literals", () => {
    const found = rules(OURS).flatMap((r) =>
      (r.body.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []).filter((c) => !KEPT.has(c)).map((c) => `${r.selector}: ${c}`),
    );
    expect(rules(OURS).length).toBeGreaterThan(20);
    expect(found).toEqual([]);
  });

  it("put the stack bottom-right, lifted by the composer's clearance", () => {
    const stack = rules(/^\.toasts$/).map((r) => r.body).join("\n");
    expect(stack).toMatch(/bottom:\s*var\(--toasts-bottom,\s*16px\)/);
    expect(stack).toMatch(/right:\s*16px/);
    expect(stack).not.toMatch(/\btop:/);
  });

  it("calm the toasts' and the sheet's motion under reduced-motion", () => {
    const reduced = Array.from(CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g), (m) => m[1]).join("\n");
    expect(reduced).toMatch(/\.toast\s*\{\s*animation-name:\s*toast-fade-in/);
    expect(reduced).toMatch(/\.toast\.is-closing\s*\{\s*animation-name:\s*toast-fade-out/);
    expect(reduced).toMatch(/\.notify-panel\s*\{\s*animation:\s*none/);
    expect(reduced).toMatch(/\.toast \.ncard-badge\s*\{\s*animation:\s*none/);
  });

  it("draw a card in its category's hue, and what waits on you louder", () => {
    const of = (selector: string) => rules(new RegExp(`^${selector.replace(/[.]/g, "\\.")}$`)).map((r) => r.body).join("\n");
    expect(of(".ncard-badge")).toMatch(/var\(--ncard-hue\)/);
    expect(of(".ncard-dot")).toMatch(/background:\s*var\(--ncard-hue\)/);
    expect(of(".ncard.is-prominent")).toMatch(/border-color:[^;]*--ncard-hue/);
    expect(of(".ncard.is-prominent .ncard-badge")).toMatch(/background:\s*var\(--ncard-hue\)/);
  });

  it("let FadeScroll own the sheet's scrolling", () => {
    const body = rules(/^\.notify-body$/).map((r) => r.body).join("\n");
    expect(body).not.toMatch(/overflow|padding-top|padding:/);
  });
});
