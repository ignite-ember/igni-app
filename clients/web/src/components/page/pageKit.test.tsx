// @vitest-environment jsdom
/**
 * The shared page pieces: what each draws, and the keyboard and menu
 * behaviour the pages built on them rely on.
 *
 * Contracts worth pinning:
 *   • A card with `onOpen` is a button by keyboard too, but Enter on
 *     the action inside it belongs to that action.
 *   • Optional slots draw nothing when left out — no empty footers or
 *     chip rows holding space.
 *   • Header controls appear only when asked for, one menu open at a
 *     time, and a menu is lit when it narrows anything.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CardGrid } from "./CardGrid";
import { CardGridSkeleton } from "./CardGridSkeleton";
import { EntityCard } from "./EntityCard";
import { EntityHero } from "./EntityHero";
import { PageEmpty } from "./PageEmpty";
import { PageHeaderControls } from "./PageHeaderControls";
import { PageLoading } from "./PageLoading";
import { PageTabs } from "./PageTabs";

afterEach(cleanup);

describe("EntityCard", () => {
  it("draws the name, initials, description and footer", () => {
    const { container } = render(
      <EntityCard name="acme tools" description="Does things" footer={<span>v1</span>} />,
    );
    expect(screen.getByText("acme tools")).toBeTruthy();
    expect(container.querySelector(".entity-glyph")?.textContent).toBe("AT");
    expect(container.querySelector(".entity-card-desc")?.textContent).toBe("Does things");
    expect(container.querySelector(".entity-card-foot")?.textContent).toBe("v1");
  });

  it("is not a button without onOpen, and leaves out empty slots", () => {
    const { container } = render(<EntityCard name="plain" />);
    const card = container.querySelector(".entity-card")!;
    expect(card.getAttribute("role")).toBeNull();
    expect(card.getAttribute("tabindex")).toBeNull();
    expect(container.querySelector(".entity-card-desc")).toBeNull();
    expect(container.querySelector(".entity-card-foot")).toBeNull();
  });

  it("takes its initials from glyph when the name is not text, and a custom icon over both", () => {
    const { container, rerender } = render(<EntityCard name={<b>rich</b>} glyph="zed" />);
    expect(container.querySelector(".entity-glyph")?.textContent).toBe("ZE");
    rerender(<EntityCard name="x" icon={<i data-testid="own" />} />);
    expect(screen.getByTestId("own")).toBeTruthy();
    expect(container.querySelector(".entity-glyph")).toBeNull();
  });

  it("opens on click, Enter and Space, but not on keys aimed at its action", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <EntityCard
        name="card"
        label="Open card"
        className="extra"
        onOpen={onOpen}
        action={<button>act</button>}
        chips={<span className="chip">c</span>}
      >
        <span data-testid="child" />
      </EntityCard>,
    );
    const card = screen.getByRole("button", { name: "Open card" });
    expect(card.className).toBe("entity-card extra");
    expect(container.querySelector(".chip")).toBeTruthy();
    expect(screen.getByTestId("child")).toBeTruthy();
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    fireEvent.keyDown(card, { key: "a" });
    expect(onOpen).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(screen.getByText("act"), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });
});

describe("CardGrid", () => {
  it("is a plain grid, or a masonry flow when asked", () => {
    const { container, rerender } = render(
      <CardGrid>
        <div />
      </CardGrid>,
    );
    expect(container.firstElementChild?.className).toBe("card-grid");
    rerender(
      <CardGrid flow className="mine">
        <div />
      </CardGrid>,
    );
    expect(container.firstElementChild?.className).toBe("card-grid card-grid--flow mine");
    rerender(
      <CardGrid className="mine">
        <div />
      </CardGrid>,
    );
    expect(container.firstElementChild?.className).toBe("card-grid mine");
    rerender(
      <CardGrid flow>
        <div />
      </CardGrid>,
    );
    expect(container.firstElementChild?.className).toBe("card-grid card-grid--flow");
  });

  it("has a skeleton in the same shape", () => {
    const { container } = render(<CardGridSkeleton count={3} />);
    expect(container.querySelectorAll(".card-grid > .entity-card")).toHaveLength(3);
  });
});

describe("EntityHero", () => {
  it("draws the name as a heading with its meta, and only the slots given", () => {
    const { container, rerender } = render(<EntityHero name="thing" />);
    expect(screen.getByRole("heading", { name: "thing" })).toBeTruthy();
    expect(container.querySelector(".entity-hero-desc")).toBeNull();
    expect(container.querySelector(".entity-hero-chips")).toBeNull();
    expect(container.querySelector(".entity-hero-actions")).toBeNull();
    rerender(
      <EntityHero
        name="thing"
        icon={<i data-testid="icon" />}
        leading={<span data-testid="dot" />}
        meta={<span>v2</span>}
        description="what it is"
        chips={<span>chip</span>}
        actions={<button>Do</button>}
      />,
    );
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(screen.getByTestId("dot")).toBeTruthy();
    expect(screen.getByText("v2")).toBeTruthy();
    expect(container.querySelector(".entity-hero-desc")?.textContent).toBe("what it is");
    expect(container.querySelector(".entity-hero-chips")?.textContent).toBe("chip");
    expect(screen.getByRole("button", { name: "Do" })).toBeTruthy();
  });
});

describe("PageEmpty and PageLoading", () => {
  it("draws a title, and a hint and action only when given", () => {
    const { container, rerender } = render(<PageEmpty title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeTruthy();
    expect(container.querySelector(".page-empty-hint")).toBeNull();
    expect(container.querySelector(".page-empty-action")).toBeNull();
    rerender(<PageEmpty title="Nothing here" hint="Add one" action={<button>Add</button>} />);
    expect(screen.getByText("Add one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });

  it("announces loading, with its own words when given", () => {
    const { rerender } = render(<PageLoading />);
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    rerender(<PageLoading label="Reading…" />);
    expect(screen.getByRole("status").textContent).toBe("Reading…");
  });
});

describe("PageTabs", () => {
  it("marks the current tab, shows counts when given, and selects", () => {
    const onSelect = vi.fn();
    render(
      <PageTabs
        tabs={[
          { key: "a", label: "Alpha", count: 3 },
          { key: "b", label: "Beta" },
        ]}
        current="a"
        onSelect={onSelect}
        controls={<span data-testid="controls" />}
      />,
    );
    const alpha = screen.getByRole("button", { name: /^Alpha/ });
    expect(alpha.className).toContain("active");
    expect(screen.getByRole("button", { name: "Beta" }).querySelector(".page-tab-count")).toBeNull();
    expect(screen.getByTestId("controls")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("PageHeaderControls", () => {
  const options = [
    { key: "all", label: "All" },
    { key: "some", label: "Some" },
  ] as const;

  it("draws nothing it was not asked for", () => {
    const { container } = render(<PageHeaderControls />);
    expect(container.querySelector(".page-controls")?.children).toHaveLength(0);
  });

  it("opens one menu at a time, lights a narrowing one, and picks", () => {
    const onFilter = vi.fn();
    const onSort = vi.fn();
    render(
      <PageHeaderControls
        filter={{ options, current: "some", onPick: onFilter }}
        sort={{ options, current: "all", onPick: onSort, label: "Order", icon: <i /> }}
      />,
    );
    const filter = screen.getByRole("button", { name: "Filter" });
    const sort = screen.getByRole("button", { name: "Order" });
    expect(filter.className).toContain("is-active");
    expect(sort.className).not.toContain("is-active");

    fireEvent.click(filter);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    fireEvent.click(sort);
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(sort.getAttribute("aria-expanded")).toBe("true");
    expect(filter.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(sort);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(filter);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "All" }));
    expect(onFilter).toHaveBeenCalledWith("all");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("honours an explicit active over the default", () => {
    render(<PageHeaderControls filter={{ options, current: "all", onPick: () => {}, active: true }} />);
    expect(screen.getByRole("button", { name: "Filter" }).className).toContain("is-active");
  });

  it("searches, refreshes with a spinner while busy, and calls the gear and extras", () => {
    const onChange = vi.fn();
    const onRefresh = vi.fn();
    const onGear = vi.fn();
    const { container, rerender } = render(
      <PageHeaderControls
        search={{ value: "", onChange, label: "Search things", placeholder: "Search…" }}
        refresh={{ onClick: onRefresh, label: "Refresh" }}
        settings={{ onClick: onGear, label: "Settings", title: "Manage things" }}
      >
        <button>extra</button>
      </PageHeaderControls>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Search things" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search things" }), {
      target: { value: "x" },
    });
    expect(onChange).toHaveBeenCalledWith("x");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
    const gear = screen.getByRole("button", { name: "Settings" });
    expect(gear.getAttribute("title")).toBe("Manage things");
    fireEvent.click(gear);
    expect(onGear).toHaveBeenCalled();
    // The extras sit between refresh and the gear.
    const labels = Array.from(container.querySelectorAll(".page-controls > button")).map(
      (b) => b.getAttribute("aria-label") ?? b.textContent,
    );
    expect(labels.slice(-3)).toEqual(["Refresh", "extra", "Settings"]);

    rerender(<PageHeaderControls refresh={{ onClick: onRefresh, label: "Refresh", busy: true }} />);
    const busy = screen.getByRole("button", { name: "Refresh" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.querySelector(".icon-spinner")).toBeTruthy();
  });
});
