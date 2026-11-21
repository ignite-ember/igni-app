// @vitest-environment jsdom
/**
 * A reply is the model's text, and the model can be steered by anything it
 * read (a prompt injection in a file, a web page). These pin what the chat
 * renderer does with hostile markdown: HTML stays text, dangerous URL
 * schemes never become links, and a link that leaves igni opens apart from
 * the app. docs/ENTERPRISE_TEST_PLAN.md SEC-001, SEC-002, SEC-004; the same
 * cases run end to end in e2e/scenario-security.spec.ts.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { PlainMarkdown } from "./PlainMarkdown";

function renderReply(markdown: string): HTMLElement {
  return render(<PlainMarkdown text={markdown} />).container;
}

describe("a reply's markdown", () => {
  it("SEC-001 renders HTML as text, creating no element", () => {
    const html = [
      "<script>window.__pwned = 1</script>",
      '<img src="x" onerror="window.__pwned = 2">',
      '<iframe src="https://evil.example"></iframe>',
      '<svg onload="window.__pwned = 3"></svg>',
      '<a href="#" onclick="window.__pwned = 4">x</a>',
    ].join("\n\n");
    const root = renderReply(html);
    expect(root.querySelector("script, img, iframe, svg, [onclick], [onerror], [onload]")).toBeNull();
    expect(root.textContent).toContain("<script>");
  });

  it("SEC-002 never turns javascript:, vbscript: or data: into a link", () => {
    const root = renderReply(
      "[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) [c](vbscript:msgbox(1)) [d](data:text/html,<b>x</b>) ![e](javascript:alert(1))",
    );
    const urls = [...root.querySelectorAll("a, img")].map(
      (el) => el.getAttribute("href") ?? el.getAttribute("src") ?? "",
    );
    for (const url of urls) expect(url.toLowerCase()).not.toMatch(/^(javascript|vbscript|data):/);
  });

  it("SEC-004 opens a web link in a new context with no opener and no referrer", () => {
    const root = renderReply("See [the docs](https://example.com/x) or [mail](mailto:a@example.com).");
    for (const a of root.querySelectorAll("a")) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("leaves a link inside the app (an anchor, a relative path) in place", () => {
    const root = renderReply("[top](#top) [file](./calc.py)");
    for (const a of root.querySelectorAll("a")) {
      expect(a.getAttribute("target")).toBeNull();
    }
  });

  it("lets a caller's own renderers win over the default link", () => {
    const { container } = render(
      <PlainMarkdown text="[x](https://example.com)" components={{ a: () => <span data-own="1" /> }} />,
    );
    expect(container.querySelector("[data-own]")).not.toBeNull();
  });
});
