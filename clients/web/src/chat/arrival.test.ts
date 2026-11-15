import { describe, expect, it } from "vitest";

import { Arrivals, MAX_PLACE_SEARCH } from "./arrival";
import { LOCATION_LIMITS } from "./pageStack";

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

  it("is no arrival for a page kind no page could have", () => {
    expect(Arrivals.fromSearch("?open=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E")).toBeNull();
    expect(Arrivals.fromSearch("?open=javascript%3Aalert(1)")).toBeNull();
    expect(Arrivals.fromSearch(`?open=${"a".repeat(129)}`)).toBeNull();
    expect(Arrivals.fromSearch(`?open=${"a".repeat(128)}`)?.page).toHaveLength(128);
  });

  it("keeps only the location a page could have set", () => {
    const long = "x".repeat(LOCATION_LIMITS.valueLength + 1);
    const many = Array.from({ length: LOCATION_LIMITS.keys + 4 }, (_, i) => `k${i}=${i}`).join("&");
    const arrival = Arrivals.fromSearch(`?open=acme.notes&long=${long}&${"k".repeat(65)}=v&${many}`);
    expect(arrival?.params.long).toBeUndefined();
    expect(Object.keys(arrival?.params ?? {})).toHaveLength(LOCATION_LIMITS.keys);
    expect(Arrivals.fromSearch("?open=acme.notes&__proto__=x&toString=y")?.params).toEqual({ toString: "y" });
  });

  it("keeps a param's first value", () => {
    expect(Arrivals.fromSearch("?open=acme.notes&note=a&note=b")?.params).toEqual({ note: "a" });
  });

  it("opens its page alone, named by its kind until the label is known", () => {
    expect(Arrivals.route({ page: "acme.notes", params: { note: "a" } })).toEqual([
      { kind: "acme.notes", label: "acme.notes", params: { note: "a" } },
    ]);
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

  it("leaves nothing for the chat", () => {
    expect(Arrivals.placeSearch("?dir=%2Fsrc&open=acme.notes&version=2.3.1", null)).toBe("?dir=%2Fsrc");
  });

  it("names a page that has no location yet, so the link still opens it", () => {
    expect(Arrivals.placeSearch("?dir=%2Fsrc", { kind: "acme.notes", label: "Release notes" })).toBe(
      "?dir=%2Fsrc&open=acme.notes",
    );
  });

  it("keeps the desktop shell's own parameters", () => {
    const search = Arrivals.placeSearch("?ws=ws%3A%2F%2Fx&host=tauri", notes);
    expect(new URLSearchParams(search).get("host")).toBe("tauri");
    expect(Arrivals.placeSearch(search, null)).toBe("?ws=ws%3A%2F%2Fx&host=tauri");
  });

  it("names the page without its location when the address would be too long", () => {
    const params: Record<string, string> = {};
    for (let i = 0; i < LOCATION_LIMITS.keys; i++) params[`k${i}`] = "é".repeat(LOCATION_LIMITS.valueLength);
    const search = Arrivals.placeSearch("?dir=%2Fsrc", { ...notes, params });
    expect(search).toBe("?dir=%2Fsrc&open=acme.notes");
    const fits = Arrivals.placeSearch("", { ...notes, params: { k: "x".repeat(LOCATION_LIMITS.valueLength) } });
    expect(fits.length).toBeLessThanOrEqual(MAX_PLACE_SEARCH);
    expect(Arrivals.fromSearch(fits)?.params.k).toHaveLength(LOCATION_LIMITS.valueLength);
  });

  it("writes no page whose kind no link could name", () => {
    expect(Arrivals.placeSearch("?dir=%2Fsrc", { ...notes, kind: "<script>" })).toBe("?dir=%2Fsrc");
  });

  it("does not write a param igni would read as its own", () => {
    const search = Arrivals.placeSearch("", { ...notes, params: { version: "2.3.1", ws: "evil" } });
    expect(new URLSearchParams(search).get("ws")).toBeNull();
  });
});
