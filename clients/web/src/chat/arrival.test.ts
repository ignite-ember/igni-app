import { describe, expect, it } from "vitest";

import { Arrivals } from "./arrival";

describe("a link that opens a page", () => {
  it("names the page and hands it the rest as params", () => {
    expect(Arrivals.fromSearch("?open=igni.artifacts&slug=runbook&comment=c1")).toEqual({
      page: "igni.artifacts",
      params: { slug: "runbook", comment: "c1" },
    });
  });

  it("keeps igni's own parameters out of the page's", () => {
    expect(Arrivals.fromSearch("?dir=%2Fsrc%2Fapp&open=acme.notes&ws=ws%3A%2F%2Fx&note=n2")).toEqual({
      page: "acme.notes",
      params: { note: "n2" },
    });
  });

  it("is no arrival without `open`", () => {
    expect(Arrivals.fromSearch("?dir=%2Fsrc&slug=runbook")).toBeNull();
    expect(Arrivals.fromSearch("?open=")).toBeNull();
  });

  it("comes out of the address bar whole, leaving igni's own", () => {
    expect(Arrivals.withoutArrival("?dir=%2Fsrc&open=igni.artifacts&slug=runbook")).toBe(
      "?dir=%2Fsrc",
    );
    expect(Arrivals.withoutArrival("?open=igni.artifacts&slug=runbook")).toBe("");
    expect(Arrivals.withoutArrival("?dir=%2Fsrc")).toBe("?dir=%2Fsrc");
  });
});

describe("the address bar shows where the window is", () => {
  // The bridge promises the host folds a page's setLocation into its own
  // URL. Kept only in the window's saved route, the address never
  // changed, and the same link opened elsewhere showed the chat (R459).
  const notes = { kind: "acme.notes", label: "Release notes", params: { version: "2.3.1" } };

  it("writes a page's location as a link back to it, keeping igni's own", () => {
    const search = Arrivals.placeSearch("?ws=ws%3A%2F%2Fx", notes);
    expect(Arrivals.fromSearch(search)).toEqual({ page: "acme.notes", params: { version: "2.3.1" } });
    expect(new URLSearchParams(search).get("ws")).toBe("ws://x");
  });

  it("replaces the link the window arrived by", () => {
    const search = Arrivals.placeSearch("?open=acme.notes&version=2.4.0", notes);
    expect(Arrivals.fromSearch(search)).toEqual({ page: "acme.notes", params: { version: "2.3.1" } });
  });

  it("leaves nothing for the chat or a page without params", () => {
    expect(Arrivals.placeSearch("?dir=%2Fsrc&open=acme.notes&version=2.3.1", null)).toBe("?dir=%2Fsrc");
    expect(Arrivals.placeSearch("?open=plugins", { kind: "plugins", label: "Plugins" })).toBe("");
  });

  it("does not write a param igni would read as its own", () => {
    const search = Arrivals.placeSearch("", { ...notes, params: { version: "2.3.1", ws: "evil" } });
    expect(new URLSearchParams(search).get("ws")).toBeNull();
  });
});
