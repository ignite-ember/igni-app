/**
 * The sidebar's part of the window model (``ui.sidebar``): whether it is
 * out, and which part of its list is in view. Each change is one
 * read-modify-write of the field, so the width an extension set stays.
 */

import type { CSSProperties } from "react";

import { SIDEBAR_BREAKPOINT_PX, type Sidebar, type WindowModel } from "../clientState";

export class SidebarLayout {
  constructor(private readonly windowModel: Pick<WindowModel, "get" | "write">) {}

  /** Wide enough for the sidebar to sit beside the chat rather than
   *  over it: at or below the breakpoint it starts closed, and picking
   *  a session closes it. */
  static opensAt(widthPx: number): boolean {
    return widthPx > SIDEBAR_BREAKPOINT_PX;
  }

  /** What the views show until the model answers. */
  static initialFor(widthPx: number): Sidebar {
    return { open: SidebarLayout.opensAt(widthPx), width: null, section: null };
  }

  /** ``ui.sidebar.width``: an extension (or a future resize handle)
   *  sizes the sidebar; ``null`` keeps the stylesheet's. */
  static styleFor(sidebar: Pick<Sidebar, "width">): CSSProperties | undefined {
    return sidebar.width ? ({ "--sidebar-w": `${sidebar.width}px` } as CSSProperties) : undefined;
  }

  setOpen = (open: boolean): void => {
    this.windowModel.write("sidebar", { ...this.windowModel.get("sidebar"), open });
  };

  toggle = (): void => this.setOpen(!this.windowModel.get("sidebar").open);

  close = (): void => this.setOpen(false);

  setSection = (section: Sidebar["section"]): void => {
    this.windowModel.write("sidebar", { ...this.windowModel.get("sidebar"), section });
  };
}
