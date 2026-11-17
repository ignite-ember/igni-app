// @vitest-environment jsdom
/** The welcome screen's command cards are reachable by keyboard. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WelcomeScreen } from "./WelcomeScreen";

afterEach(cleanup);

describe("WelcomeScreen", () => {
  it("offers its commands as buttons, so a signed-in welcome still has something to focus", () => {
    // Signed in with no model: the first-run block offers no sign-in
    // button (R639), so the cards are all a keyboard can reach, and
    // axe fails a scrollable region with nothing focusable (R683).
    const onCommand = vi.fn();
    render(
      <WelcomeScreen
        groupName="igni"
        groupMark={null}
        status={{ model_configured: false, cloud_email: "me@example.com" } as never}
        onLogin={vi.fn()}
        onCommand={onCommand}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(onCommand).toHaveBeenCalledTimes(1);
  });
});
