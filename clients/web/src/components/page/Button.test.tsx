// @vitest-environment jsdom
/**
 * The page button and its card form: what each variant draws, and that
 * busy, disabled and a card's action behave.
 *
 * Contracts worth pinning:
 *   • Every variant is one `.button` with a variant and a size class —
 *     never the old `.btn` or the gradient.
 *   • Busy disables the button and swaps its icon for a spinner.
 *   • A card's action never opens the card it sits on.
 *   • The header's "+ Add" is the primary, after every icon.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Button, buttonClass } from "./Button";
import { CardAction, PlayGlyph } from "./CardAction";
import { EntityCard } from "./EntityCard";
import { PageHeaderControls } from "./PageHeaderControls";

afterEach(cleanup);

describe("Button", () => {
  it("is a quiet secondary at md by default, typed as a plain button", () => {
    render(<Button>Copy</Button>);
    const b = screen.getByRole("button", { name: "Copy" });
    expect(b.className).toBe("button button--secondary button--md");
    expect(b.getAttribute("type")).toBe("button");
    expect(b.getAttribute("aria-busy")).toBeNull();
    expect(b.getAttribute("title")).toBeNull();
  });

  it.each(["primary", "secondary", "danger", "icon"] as const)("draws the %s variant", (variant) => {
    render(
      <Button variant={variant} size="sm" label="Go" icon={<i data-testid="ic" />}>
        Go
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Go" });
    expect(b.classList.contains(`button--${variant}`)).toBe(true);
    expect(b.classList.contains("button--sm")).toBe(true);
    expect(b.className).not.toMatch(/\bbtn\b/);
    expect(screen.getByTestId("ic")).toBeTruthy();
  });

  it("puts a leading icon in its slot, a label after it, and a chevron for a menu", () => {
    const { container } = render(
      <Button variant="primary" icon={<i data-testid="plus" />} chevron>
        Add
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Add" });
    expect(b.firstElementChild?.className).toBe("button-icon");
    expect(b.textContent).toBe("Add");
    expect(container.querySelector(".button-chevron svg")).toBeTruthy();
  });

  it("an icon button is only its icon, named and titled by its label", () => {
    render(
      <Button variant="icon" label="Refresh" active>
        <i data-testid="glyph" />
        ignored text is still the icon
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Refresh" });
    expect(b.getAttribute("title")).toBe("Refresh");
    expect(b.classList.contains("is-active")).toBe(true);
    expect(b.querySelector(".button-icon")).toBeNull();
    expect(screen.getByTestId("glyph")).toBeTruthy();
  });

  it("an icon button prefers its icon prop, and keeps an explicit title", () => {
    render(<Button variant="icon" label="Gear" title="Manage" icon={<i data-testid="own" />} />);
    const b = screen.getByRole("button", { name: "Gear" });
    expect(b.getAttribute("title")).toBe("Manage");
    expect(screen.getByTestId("own")).toBeTruthy();
  });

  it("keeps an aria-label passed straight through when it has no label", () => {
    render(<Button aria-label="Install from URL">Install</Button>);
    expect(screen.getByRole("button", { name: "Install from URL" })).toBeTruthy();
  });

  it("is disabled and spins while busy, in place of its icon", () => {
    const onClick = vi.fn();
    render(
      <Button icon={<i data-testid="ic" />} busy onClick={onClick}>
        Install
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Install" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.querySelector(".icon-spinner")).toBeTruthy();
    expect(screen.queryByTestId("ic")).toBeNull();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("an icon button spins too", () => {
    render(<Button variant="icon" label="Reload" busy />);
    expect(screen.getByRole("button", { name: "Reload" }).querySelector(".icon-spinner")).toBeTruthy();
  });

  it("passes extra classes and a submit type through, and clicks", () => {
    const onClick = vi.fn();
    render(
      <Button className="mine" type="submit" onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Save" });
    expect(b.classList.contains("mine")).toBe(true);
    expect(b.getAttribute("type")).toBe("submit");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("buttonClass spells the same classes for a link drawn as a button", () => {
    expect(buttonClass()).toBe("button button--secondary button--md");
    expect(buttonClass("primary", "sm", "ext-web-link")).toBe("button button--primary button--sm ext-web-link");
  });
});

describe("CardAction", () => {
  it("is a round icon button that runs without opening its card", () => {
    const onOpen = vi.fn();
    const onRun = vi.fn();
    render(
      <EntityCard name="commit" label="Open commit" onOpen={onOpen} action={<CardAction label="Run /commit" onClick={onRun} />} />,
    );
    const run = screen.getByRole("button", { name: "Run /commit" });
    expect(run.className).toContain("button--icon");
    expect(run.className).toContain("card-action");
    expect(run.querySelector("svg")).toBeTruthy();
    fireEvent.click(run);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("takes its own icon, a danger tint, extra classes, busy and disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <CardAction label="Discard" title="Throw it away" danger className="x" disabled onClick={onClick}>
        <i data-testid="trash" />
      </CardAction>,
    );
    const b = screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement;
    expect(b.className).toContain("is-danger");
    expect(b.getAttribute("title")).toBe("Throw it away");
    expect(b.className).toContain("x");
    expect(b.disabled).toBe(true);
    expect(screen.getByTestId("trash")).toBeTruthy();
    rerender(<CardAction label="Discard" busy onClick={onClick} />);
    expect(screen.getByRole("button", { name: "Discard" }).querySelector(".icon-spinner")).toBeTruthy();
  });

  it("PlayGlyph takes a size", () => {
    const { container } = render(<PlayGlyph size={20} />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("20");
  });
});

describe("PageHeaderControls' primary", () => {
  it("draws the + Add button last, as the primary, and calls it", () => {
    const onAdd = vi.fn();
    const { container } = render(
      <PageHeaderControls
        refresh={{ onClick: () => {}, label: "Refresh" }}
        add={{ text: "Add server", label: "Add an MCP server", onClick: onAdd }}
      />,
    );
    const add = screen.getByRole("button", { name: "Add an MCP server" });
    expect(add.className).toContain("button--primary");
    expect(add.textContent).toBe("Add server");
    expect(add.getAttribute("title")).toBe("Add an MCP server");
    expect(container.querySelector(".page-controls")?.lastElementChild).toBe(add);
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
