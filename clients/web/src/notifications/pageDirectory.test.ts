/** The pages a notification can point at, and what each is called on a
 *  button: igni's own by their menu names, an extension's as
 *  "Extension › Page". */
import { describe, expect, it } from "vitest";

import { BASE_SIDEBAR_LINKS, BASE_TOOLS_MENU } from "../extensions/baseNavigation";
import { Contributions } from "../extensions/contributions";
import type { UiContribution } from "../extensions/contributions";
import type { ExtensionSummary } from "../extensions/ExtensionPage";
import { PageDirectory } from "./pageDirectory";

const REVIEWER: UiContribution = {
  pages: [{ kind: "findings", label: "Findings", sidebar: true }],
  menu: [],
};

const EXTENSION = {
  id: "acme.review",
  name: "Code review",
  pages: [{ kind: "findings", label: "Findings" }],
} as unknown as ExtensionSummary;

function contributions(withReviewer = false) {
  const c = new Contributions(BASE_SIDEBAR_LINKS, BASE_TOOLS_MENU);
  if (withReviewer) c.install("acme.review", REVIEWER);
  return c;
}

describe("the page directory", () => {
  it("calls an extension's page by its extension and its own name", () => {
    const directory = new PageDirectory(contributions(true), [EXTENSION]);
    expect(directory.has("findings")).toBe(true);
    expect(directory.label("findings")).toBe("Code review › Findings");
  });

  it("calls igni's own pages by their menu names", () => {
    const directory = new PageDirectory(contributions(), []);
    expect(directory.has("schedule")).toBe(true);
    expect(directory.label("schedule")).toBe("Scheduled tasks");
    expect(directory.label("plugins")).toBe("Plugins");
  });

  it("says nothing for a page that is not here", () => {
    const directory = new PageDirectory(contributions(), []);
    expect(directory.has("acme.gone")).toBe(false);
    expect(directory.label("acme.gone")).toBeNull();
  });
});
