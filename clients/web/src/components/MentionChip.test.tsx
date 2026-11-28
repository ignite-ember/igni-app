// @vitest-environment jsdom
/**
 * The chip a file mentioned inside a sentence is drawn as.
 *
 * Contracts worth pinning:
 *   • It shows the file's name, not its path; the path is what the
 *     hover reveals.
 *   • Hovering or focusing it reveals the path and the two actions —
 *     copy the path, open the file in the read-only viewer.
 *   • The viewer is the only way a file opens: nothing here reaches
 *     for the host's own file opening.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MentionChip } from "./MentionChip";
import { host } from "../lib/host";
import { FileViewerContext } from "./pages/files/viewerContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PATH = "/Users/dz/proj/src/foo.py";

function renderChip(path = PATH, open = vi.fn()) {
  const view = render(
    <FileViewerContext.Provider value={{ open }}>
      <MentionChip path={path} />
    </FileViewerContext.Provider>,
  );
  return { ...view, open };
}

describe("the chip, idle", () => {
  it("shows the file's name, not its path", () => {
    renderChip();
    expect(screen.getByText("foo.py")).toBeTruthy();
    expect(screen.queryByText(PATH)).toBeNull();
  });

  it("shows no path and no action until it is hovered or focused", () => {
    const { container } = renderChip();
    expect(container.querySelector(".mention-chip-panel")).toBeNull();
    expect(screen.queryByText("Copy path")).toBeNull();
  });
});

describe("the chip, hovered", () => {
  it("reveals the path and the actions", () => {
    const { container } = renderChip();
    fireEvent.mouseEnter(container.querySelector(".mention-chip-wrap") as HTMLElement);
    expect(container.querySelector(".mention-chip-panel")).toBeTruthy();
    expect(screen.getByText(PATH)).toBeTruthy();
    expect(screen.getByText("Copy path")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("hides them again when the pointer leaves", () => {
    const { container } = renderChip();
    const wrap = container.querySelector(".mention-chip-wrap") as HTMLElement;
    fireEvent.mouseEnter(wrap);
    fireEvent.mouseLeave(wrap);
    expect(container.querySelector(".mention-chip-panel")).toBeNull();
  });
});

describe("the chip, focused", () => {
  it("reveals the path and the actions on focus", () => {
    const { container } = renderChip();
    fireEvent.focus(container.querySelector(".mention-chip-wrap") as HTMLElement);
    expect(container.querySelector(".mention-chip-panel")).toBeTruthy();
    expect(screen.getByText(PATH)).toBeTruthy();
  });

  it("Escape closes the panel", () => {
    const { container } = renderChip();
    const wrap = container.querySelector(".mention-chip-wrap") as HTMLElement;
    fireEvent.focus(wrap);
    fireEvent.keyDown(wrap, { key: "Escape" });
    expect(container.querySelector(".mention-chip-panel")).toBeNull();
  });
});

describe("the chip's actions", () => {
  it("copies the full path, not the name", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = renderChip();
    fireEvent.mouseEnter(container.querySelector(".mention-chip-wrap") as HTMLElement);
    fireEvent.click(screen.getByText("Copy path"));
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(PATH);
  });

  it("says so once the path is copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { container } = renderChip();
    fireEvent.mouseEnter(container.querySelector(".mention-chip-wrap") as HTMLElement);
    fireEvent.click(screen.getByText("Copy path"));
    await Promise.resolve();
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("opens the file in the read-only viewer", () => {
    const { container, open } = renderChip();
    fireEvent.mouseEnter(container.querySelector(".mention-chip-wrap") as HTMLElement);
    fireEvent.click(screen.getByText("Open"));
    expect(open).toHaveBeenCalledWith(PATH);
  });

  it("offers no editor, even where the host could open files natively", () => {
    vi.spyOn(host, "canOpenNatively", "get").mockReturnValue(true);
    const openFile = vi.spyOn(host, "openFile").mockResolvedValue(true);
    const { container } = renderChip();
    fireEvent.mouseEnter(container.querySelector(".mention-chip-wrap") as HTMLElement);
    const actions = screen
      .getAllByRole("button")
      .filter((b) => b.classList.contains("mention-chip-action"))
      .map((b) => b.textContent);
    expect(actions).toEqual(["Copy path", "Open"]);
    expect(openFile).not.toHaveBeenCalled();
  });

  it("offers only the copy where no viewer is wired", () => {
    const { container } = render(<MentionChip path={PATH} />);
    fireEvent.mouseEnter(container.querySelector(".mention-chip-wrap") as HTMLElement);
    expect(screen.queryByText("Open")).toBeNull();
    expect(screen.getByText("Copy path")).toBeTruthy();
  });
});
