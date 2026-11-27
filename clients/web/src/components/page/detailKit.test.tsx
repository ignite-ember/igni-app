// @vitest-environment jsdom
/**
 * The one detail-page layout: the pieces every thing's own page is built
 * from, and the stylesheet rules that make them look alike.
 *
 * Contracts worth pinning:
 *   • A section is a labelled region with its label (and count) inside
 *     it, and draws no count or actions it was not given.
 *   • Facts leave out the rows they were not given, and set a value in
 *     mono only when asked.
 *   • The hero's name is a plain heading: no rule anywhere in the sheet
 *     paints it in the accent or in mono, and its meta and chips are sans.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { DetailFacts } from "./DetailFacts";
import { DetailMarkdown } from "./DetailMarkdown";
import { DetailSection } from "./DetailSection";
import { EntityHero } from "./EntityHero";
import { HeroChip } from "./HeroChip";

afterEach(cleanup);

const CSS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../theme.css"),
  "utf8",
);

/** Every rule whose selector list names `selector`, as [selectors, body]. */
function rulesFor(selector: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of CSS.matchAll(re)) {
    const selectors = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (selectors.split(",").some((s) => s.trim().split(/\s+/).pop() === selector)) {
      out.push([selectors, m[2]]);
    }
  }
  return out;
}

describe("DetailSection", () => {
  it("is a region named by its label, the label and count inside it", () => {
    const { container } = render(
      <DetailSection title="Tools" count={2} actions={<button>Edit</button>} className="extra">
        <span>WebSearch</span>
      </DetailSection>,
    );
    const region = screen.getByRole("region", { name: "Tools" });
    expect(region.className).toBe("detail-section extra");
    const head = region.querySelector(".detail-section-head")!;
    expect(head.querySelector(".detail-section-title")?.textContent).toBe("Tools");
    expect(head.querySelector(".detail-section-count")?.textContent).toBe("2");
    expect(within(head as HTMLElement).getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(container.querySelector(".detail-section-body")?.textContent).toBe("WebSearch");
  });

  it("draws a zero count, but no count or actions when not given", () => {
    const { container, rerender } = render(<DetailSection title="README">body</DetailSection>);
    expect(container.querySelector(".detail-section")?.className).toBe("detail-section");
    expect(container.querySelector(".detail-section-count")).toBeNull();
    expect(container.querySelector(".detail-section-actions")).toBeNull();
    rerender(<DetailSection title="README" count={null}>body</DetailSection>);
    expect(container.querySelector(".detail-section-count")).toBeNull();
    rerender(<DetailSection title="Tools" count={0}>body</DetailSection>);
    expect(container.querySelector(".detail-section-count")?.textContent).toBe("0");
  });
});

describe("DetailFacts", () => {
  it("draws label/value rows, mono only where asked, and skips the falsy ones", () => {
    const { container } = render(
      <DetailFacts
        facts={[
          { label: "Path", value: "/x/agents/a.md", mono: true },
          false,
          null,
          undefined,
          { label: "Version", value: "1.2.0" },
        ]}
      />,
    );
    const rows = container.querySelectorAll(".detail-facts > .detail-fact");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("dt")?.textContent).toBe("Path");
    expect(rows[0].querySelector("dd")?.textContent).toBe("/x/agents/a.md");
    expect(rows[0].querySelector("dd")?.className).toBe("is-mono");
    expect(rows[1].querySelector("dd")?.className).toBe("");
  });

  it("draws nothing when no fact is left", () => {
    const { container } = render(<DetailFacts facts={[false, null]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("DetailMarkdown and HeroChip", () => {
  it("wrap their content in the shared classes", () => {
    const { container } = render(
      <>
        <DetailMarkdown>
          <p>prose</p>
        </DetailMarkdown>
        <HeroChip title="where">Project</HeroChip>
      </>,
    );
    expect(container.querySelector(".detail-md > p")?.textContent).toBe("prose");
    const chip = container.querySelector(".hero-chip")!;
    expect(chip.textContent).toBe("Project");
    expect(chip.getAttribute("title")).toBe("where");
  });
});

describe("EntityHero meta", () => {
  it("sits in its own wrapper beside the name, and is left out when not given", () => {
    const { container, rerender } = render(<EntityHero name="x" />);
    expect(container.querySelector(".entity-hero-meta")).toBeNull();
    rerender(<EntityHero name="x" meta={<span className="plugins-version">v2</span>} />);
    const meta = container.querySelector(".entity-hero-title-row > .entity-hero-meta");
    expect(meta?.textContent).toBe("v2");
  });
});

describe("the stylesheet draws one detail layout", () => {
  it("paints the hero's name only in the heading face and colour", () => {
    const rules = rulesFor(".entity-hero-title");
    expect(rules.length).toBeGreaterThan(0);
    for (const [sel, body] of rules) {
      expect(body, sel).not.toMatch(/font-family:\s*var\(--font-mono\)/);
      expect(body, sel).not.toMatch(/color:\s*var\(--(accent|igni-orange)/);
    }
    const base = rules.find(([sel]) => sel === ".entity-hero-title")![1];
    expect(base).toMatch(/color:\s*var\(--fg\)/);
    expect(base).toMatch(/font-weight:\s*600/);
    expect(base).toMatch(/font-family:\s*var\(--font-ui\)/);
  });

  it("keeps meta and chips in sans, down to their children", () => {
    expect(CSS).toMatch(/\.entity-hero-meta,\s*\.entity-hero-meta \* \{\s*font-family: var\(--font-ui\);/);
    expect(CSS).toMatch(/\.hero-chip,\s*\.hero-chip \* \{\s*font-family: var\(--font-ui\);/);
  });

  it("draws a section as a soft filled card with no border, one gap apart", () => {
    const section = rulesFor(".detail-section").find(([sel]) => sel === ".detail-section")![1];
    expect(section).toMatch(/background:\s*var\(--bg-surface\)/);
    expect(section).not.toMatch(/border:/);
    const detail = rulesFor(".entity-detail").find(([sel]) => sel === ".entity-detail")![1];
    expect(detail).toMatch(/gap:\s*var\(--detail-gap\)/);
  });

  it("puts markdown straight on the card, inline code in the chat's quiet style", () => {
    const md = rulesFor(".detail-md").find(([sel]) => sel === ".detail-md")![1];
    expect(md).not.toMatch(/background|border:|padding/);
    const code = rulesFor("code").find(([sel]) => sel === ".detail-md code")![1];
    expect(code).toMatch(/background:\s*var\(--bg-raised\)/);
    expect(code).toMatch(/font-size:\s*0\.9em/);
  });

  it("draws one rule under the hero and no dashed rule after it", () => {
    const hero = rulesFor(".entity-hero").find(([sel]) => sel === ".entity-hero")![1];
    expect(hero).toMatch(/border-bottom:\s*1px solid/);
    expect(CSS).not.toMatch(/\.plugins-contents\s*\{/);
  });
});
