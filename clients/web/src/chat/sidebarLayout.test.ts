import { describe, expect, it } from "vitest";

import { SIDEBAR_BREAKPOINT_PX, type Sidebar } from "../clientState";
import { SidebarLayout } from "./sidebarLayout";

function model(sidebar: Sidebar) {
  let current = sidebar;
  return {
    get: () => current,
    write: (_field: "sidebar", next: Sidebar) => {
      current = next;
    },
    current: () => current,
  };
}

describe("SidebarLayout", () => {
  it("opens beside a wide window and starts closed in a narrow one", () => {
    expect(SidebarLayout.initialFor(SIDEBAR_BREAKPOINT_PX + 1)).toEqual({
      open: true,
      width: null,
      section: null,
    });
    expect(SidebarLayout.initialFor(SIDEBAR_BREAKPOINT_PX).open).toBe(false);
    expect(SidebarLayout.opensAt(SIDEBAR_BREAKPOINT_PX)).toBe(false);
  });

  it("toggles and closes without touching the width an extension set", () => {
    const m = model({ open: true, width: 320, section: "links" });
    const layout = new SidebarLayout(m as never);
    layout.toggle();
    expect(m.current()).toEqual({ open: false, width: 320, section: "links" });
    layout.toggle();
    expect(m.current().open).toBe(true);
    layout.close();
    expect(m.current()).toEqual({ open: false, width: 320, section: "links" });
  });

  it("records the part of the list in view", () => {
    const m = model({ open: true, width: null, section: null });
    new SidebarLayout(m as never).setSection("sessions");
    expect(m.current()).toEqual({ open: true, width: null, section: "sessions" });
  });

  it("sizes the sidebar only when the model names a width", () => {
    expect(SidebarLayout.styleFor({ width: 320 })).toEqual({ "--sidebar-w": "320px" });
    expect(SidebarLayout.styleFor({ width: null })).toBeUndefined();
  });
});
