// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { readXtermLook, watchDocumentTheme } from "./xtermTheme";

describe("readXtermLook", () => {
  it("reads the stylesheet's tokens", () => {
    const root = document.createElement("div");
    root.style.setProperty("--bg-inset", "#101010");
    root.style.setProperty("--fg", "#eeeeee");
    root.style.setProperty("--accent", "#ee6138");
    root.style.setProperty("--font-mono", "Menlo");
    expect(readXtermLook(root)).toEqual({
      theme: {
        background: "#101010",
        foreground: "#eeeeee",
        cursor: "#ee6138",
        cursorAccent: "#101010",
        selectionBackground: "#ee613855",
      },
      fontFamily: "Menlo",
    });
  });

  it("falls back when the tokens read empty, and keeps a colour it cannot make translucent", () => {
    const root = document.createElement("div");
    root.style.setProperty("--accent", "rgb(1, 2, 3)");
    const look = readXtermLook(root);
    expect(look.theme.background).toBe("#1f1f1d");
    expect(look.theme.selectionBackground).toBe("rgb(1, 2, 3)");
  });
});

describe("watchDocumentTheme", () => {
  it("calls back on the theme attributes and stops when unsubscribed", async () => {
    const onChange = vi.fn();
    const stop = watchDocumentTheme(onChange);
    document.documentElement.setAttribute("data-os-prefers-light", "1");
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    document.documentElement.removeAttribute("data-os-prefers-light");
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
