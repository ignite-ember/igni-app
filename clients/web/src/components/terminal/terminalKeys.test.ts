// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { TERMINAL_ATTR, isTerminalKey } from "./terminalKeys";

describe("isTerminalKey", () => {
  it("is true only for a key typed inside the terminal", () => {
    const pane = document.createElement("div");
    pane.setAttribute(TERMINAL_ATTR, "");
    const input = document.createElement("textarea");
    pane.appendChild(input);
    document.body.appendChild(pane);
    const seen: boolean[] = [];
    const listen = (e: Event) => seen.push(isTerminalKey(e));
    window.addEventListener("keydown", listen, true);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown"));
    window.removeEventListener("keydown", listen, true);
    pane.remove();
    expect(seen).toEqual([true, false, false]);
  });
});
