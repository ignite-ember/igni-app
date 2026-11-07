/** Catalog containers: stacks, grids, cards and the components that
 *  show one of several children (carousel, tabs, accordion) or overlay
 *  them (dialog, drawer, popover, tooltip). */

import { useState } from "react";
import type React from "react";
import { NamedIcon } from "../../Icons";
import type { CatalogComponents } from "./catalogComponents";

function childList(children: React.ReactNode): React.ReactNode[] {
  return Array.isArray(children) ? children : children ? [children] : [];
}

export const layoutComponents: Pick<
  CatalogComponents,
  | "Stack"
  | "Grid"
  | "Card"
  | "Carousel"
  | "Accordion"
  | "Tabs"
  | "Dialog"
  | "Drawer"
  | "Popover"
  | "Tooltip"
> = {
  Stack: ({ props, children }) => (
    <div className={`jr-stack jr-gap-${props.gap ?? "md"}`}>{children}</div>
  ),

  Grid: ({ props, children }) => {
    const cols = Math.max(1, props.columns);
    return (
      <div
        className={`jr-grid jr-gap-${props.gap ?? "md"}`}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {children}
      </div>
    );
  },

  Card: ({ props, children }) => (
    <div className="jr-card">
      {(props.title || props.subtitle) && (
        <div className="jr-card-header">
          {props.title && <div className="jr-card-title">{props.title}</div>}
          {props.subtitle && <div className="jr-card-subtitle">{props.subtitle}</div>}
        </div>
      )}
      <div className="jr-card-body">{children}</div>
    </div>
  ),

  Carousel: ({ props, children }) => {
    const slides = childList(children);
    const [idx, setIdx] = useState(props.activeIndex ?? 0);
    const total = slides.length || 1;
    const clamped = ((idx % total) + total) % total;
    return (
      <div className="jr-carousel">
        <div className="jr-carousel-viewport">{slides[clamped] ?? null}</div>
        {total > 1 && (
          <div className="jr-carousel-controls">
            <button
              type="button"
              className="jr-btn jr-btn-ghost"
              onClick={() => setIdx((n) => n - 1)}
              aria-label="Previous slide"
            >
              <NamedIcon name="chevron" />
            </button>
            <div className="jr-carousel-dots">
              {Array.from({ length: total }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`jr-carousel-dot ${i === clamped ? "jr-carousel-dot-on" : ""}`}
                  onClick={() => setIdx(i)}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              className="jr-btn jr-btn-ghost"
              onClick={() => setIdx((n) => n + 1)}
              aria-label="Next slide"
            >
              <NamedIcon name="chevronRight" />
            </button>
          </div>
        )}
      </div>
    );
  },

  Accordion: ({ props }) => {
    const allowMultiple = props.allowMultiple ?? false;
    const [open, setOpen] = useState<Set<number>>(new Set([0]));
    const toggle = (i: number) => {
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(i)) next.delete(i);
        else {
          if (!allowMultiple) next.clear();
          next.add(i);
        }
        return next;
      });
    };
    return (
      <div className="jr-accordion">
        {props.items.map((it, i) => {
          const isOpen = open.has(i);
          return (
            <div key={i} className={`jr-accordion-item ${isOpen ? "jr-open" : ""}`}>
              <button
                type="button"
                className="jr-accordion-header"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
              >
                <span>{it.title}</span>
                <NamedIcon name={isOpen ? "chevronUp" : "chevron"} />
              </button>
              {isOpen && <div className="jr-accordion-body">{it.body ?? ""}</div>}
            </div>
          );
        })}
      </div>
    );
  },

  Tabs: ({ props, children }) => {
    const tabs = props.tabs;
    const panels = childList(children);
    const [active, setActive] = useState(props.activeIndex ?? 0);
    const n = Math.max(tabs.length, panels.length);
    if (!n) return null;
    return (
      <div className="jr-tabs">
        <div className="jr-tabs-strip" role="tablist">
          {Array.from({ length: n }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`jr-tab ${i === active ? "jr-tab-on" : ""}`}
              onClick={() => setActive(i)}
            >
              {tabs[i]?.label ?? `Tab ${i + 1}`}
            </button>
          ))}
        </div>
        <div className="jr-tabs-panel">{panels[active] ?? null}</div>
      </div>
    );
  },

  Dialog: ({ props, children }) => {
    if (props.open === false) return null;
    return (
      <div className="jr-dialog">
        {props.title && <div className="jr-dialog-header">{props.title}</div>}
        <div className="jr-dialog-body">{children}</div>
      </div>
    );
  },

  Drawer: ({ props, children }) => {
    if (props.open === false) return null;
    return (
      <div className="jr-drawer">
        {props.title && <div className="jr-drawer-header">{props.title}</div>}
        <div className="jr-drawer-body">{children}</div>
      </div>
    );
  },

  Popover: ({ props, children }) => {
    const [open, setOpen] = useState(props.open ?? false);
    return (
      <div className={`jr-popover ${open ? "jr-popover-open" : ""}`}>
        <button
          type="button"
          className="jr-btn jr-btn-ghost"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {props.label}
        </button>
        {open && <div className="jr-popover-body">{children}</div>}
      </div>
    );
  },

  Tooltip: ({ props, children }) => (
    <span className="jr-tooltip">
      <span className="jr-tooltip-anchor">{children}</span>
      <span className="jr-tooltip-bubble">{props.text}</span>
    </span>
  ),
};
