// @vitest-environment jsdom
/** A card's own action does its thing and never opens the card. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CardAction } from "./CardAction";
import { EntityCard } from "./EntityCard";

afterEach(cleanup);

describe("CardAction", () => {
  it("acts without opening the card, with a play glyph by default", () => {
    const onOpen = vi.fn();
    const onClick = vi.fn();
    render(<EntityCard name="x" label="Open x" onOpen={onOpen} action={<CardAction label="Run x" onClick={onClick} />} />);
    const btn = screen.getByRole("button", { name: "Run x" });
    expect(btn.getAttribute("title")).toBe("Run x");
    expect(btn.querySelector("svg")).toBeTruthy();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("takes its own icon, and can be disabled", () => {
    const onClick = vi.fn();
    render(
      <CardAction label="Add" onClick={onClick} disabled>
        <i data-testid="own" />
      </CardAction>,
    );
    expect(screen.getByTestId("own")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
