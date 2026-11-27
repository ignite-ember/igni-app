// @vitest-environment jsdom
/**
 * Tests for heading anchors: the slug a heading gets is GitHub's, so a
 * ``#fragment`` written for GitHub lands on the same heading here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { anchorElementId, rehypeHeadingSlugs, scrollToAnchor, slugify } from "./headingSlugs";

describe("slugify", () => {
  it("lower-cases and turns spaces into hyphens", () => {
    expect(slugify("A headless run cannot ask you anything")).toBe("a-headless-run-cannot-ask-you-anything");
  });

  it("drops punctuation but keeps hyphens and underscores", () => {
    expect(slugify("What's new? (v1.0.7) — snake_case & co.")).toBe("whats-new-v107--snake_case--co");
  });

  it("keeps letters outside ASCII", () => {
    expect(slugify("Über Größe")).toBe("über-größe");
  });
});

describe("rehypeHeadingSlugs", () => {
  const heading = (tagName: string, text: string, id?: string) => ({
    type: "element",
    tagName,
    properties: id ? { id } : {},
    children: [{ type: "text", value: text }],
  });

  it("gives each heading its slug and numbers repeats", () => {
    const tree = {
      type: "root",
      children: [heading("h2", "Install"), heading("h3", "Install"), heading("h3", "Install"), heading("p", "Install")],
    };
    rehypeHeadingSlugs()(tree);
    const ids = tree.children.map((n) => n.properties.id);
    expect(ids).toEqual(["install", "install-1", "install-2", undefined]);
  });

  it("reads the text of nested inline markup", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [
            { type: "text", value: "The " },
            { type: "element", tagName: "code", children: [{ type: "text", value: "igni" }] },
            { type: "text", value: " CLI" },
          ],
        },
      ],
    };
    rehypeHeadingSlugs()(tree);
    expect((tree.children[0].properties as { id: string }).id).toBe("the-igni-cli");
  });

  it("leaves a heading's own id alone", () => {
    const tree = { type: "root", children: [heading("h1", "Title", "custom")] };
    rehypeHeadingSlugs()(tree);
    expect(tree.children[0].properties.id).toBe("custom");
  });
});

describe("anchors", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("names the sanitized element a fragment lands on", () => {
    expect(anchorElementId("#install")).toBe("user-content-install");
    expect(anchorElementId("%C3%BCber")).toBe("user-content-über");
    expect(anchorElementId("%E0%A4%A")).toBe("user-content-%E0%A4%A");
  });

  it("scrolls to the heading and reports a missing one", () => {
    document.body.innerHTML = '<div id="root"><h2 id="user-content-install">Install</h2></div>';
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const root = document.getElementById("root");
    expect(scrollToAnchor(root, "#install")).toBe(true);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scrollToAnchor(root, "#nowhere")).toBe(false);
    expect(scrollToAnchor(root, "#")).toBe(false);
    expect(scrollToAnchor(null, "#install")).toBe(false);
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
