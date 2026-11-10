import { describe, expect, it, vi } from "vitest";

import type { PageRoute } from "./pageStack";
import { WindowNavigator, useVisiblePages } from "./windowNavigator";

const plugins: PageRoute = { kind: "plugins", label: "Plugins" };
const detail: PageRoute = { kind: "plugins", label: "Detail", params: { id: "x" } };
const hooks: PageRoute = { kind: "hooks", label: "Hooks" };

function navigator() {
  const model = { write: vi.fn() };
  return { model, nav: new WindowNavigator(model as never) };
}

describe("WindowNavigator", () => {
  it("opens a page at its top", () => {
    const { model, nav } = navigator();
    nav.openPage(plugins);
    expect(model.write).toHaveBeenCalledWith("route", [plugins]);
  });

  it("closes every page back to the chat", () => {
    const { model, nav } = navigator();
    nav.closePages();
    expect(model.write).toHaveBeenCalledWith("route", []);
  });

  it("goes one level back up the trail", () => {
    const { model, nav } = navigator();
    nav.back([plugins, detail]);
    expect(model.write).toHaveBeenCalledWith("route", [plugins]);
  });

  it("jumps to a breadcrumb, dropping what is above it", () => {
    const { model, nav } = navigator();
    nav.toCrumb([plugins, detail, hooks], 0);
    expect(model.write).toHaveBeenCalledWith("route", [plugins]);
  });

  it("keeps each method's identity when it is passed around", () => {
    const { model, nav } = navigator();
    const { openPage } = nav;
    openPage(hooks);
    expect(model.write).toHaveBeenCalledWith("route", [hooks]);
  });
});

describe("useVisiblePages", () => {
  it("draws the route up to the first page nobody knows, and names the top", () => {
    const known = { has: (kind: string) => kind === "plugins" };
    expect(useVisiblePages([plugins, detail, hooks], known)).toEqual({
      pages: [plugins, detail],
      page: detail,
    });
  });

  it("has no page while the chat shows", () => {
    expect(useVisiblePages([], { has: () => true })).toEqual({ pages: [], page: null });
  });
});
