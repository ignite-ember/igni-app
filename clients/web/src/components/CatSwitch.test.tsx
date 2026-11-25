// @vitest-environment jsdom
/**
 * The cat in the header is shown unless this device hid it: the account
 * menu's switch flips it, remembers it, and the sidebar follows at once.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CatSwitch } from "./CatSwitch";
import { setCatShown, useCatShown } from "./catSetting";

function Shown() {
  const [shown] = useCatShown();
  return <span data-testid="shown">{String(shown)}</span>;
}

beforeEach(() => {
  window.localStorage.clear();
  act(() => setCatShown(true));
});
afterEach(cleanup);

describe("the cat setting", () => {
  it("shows the cat by default and stores nothing", () => {
    render(<CatSwitch />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem("igni:sidebar-cat")).toBeNull();
  });

  it("the switch hides the cat, remembers it, and every reader follows", () => {
    render(
      <>
        <CatSwitch />
        <Shown />
      </>,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("shown").textContent).toBe("false");
    expect(window.localStorage.getItem("igni:sidebar-cat")).toBe("hidden");
  });

  it("turning it back on clears the stored choice", () => {
    act(() => setCatShown(false));
    render(<CatSwitch />);
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem("igni:sidebar-cat")).toBeNull();
  });
});
