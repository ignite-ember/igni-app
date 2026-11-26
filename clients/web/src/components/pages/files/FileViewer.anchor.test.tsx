// @vitest-environment jsdom
/**
 * Tests for a link into another file's heading: the viewer opens that
 * file and lands on the heading once it renders, instead of where the
 * file was last left; a link to a heading of the file already showing
 * just scrolls.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileViewer } from "./FileViewer";

const NO_BYTES = { path: "", data: "", mediaType: "", size: 0 };

function viewer(path: string, contents: string, onOpenFile = vi.fn(), scrollMemory = new Map<string, number>()) {
  return (
    <FileViewer
      path={path}
      file={{ path, contents, size: contents.length, language: "markdown" }}
      loading={false}
      error=""
      bytes={NO_BYTES}
      bytesLoading={false}
      bytesError=""
      wordWrap
      tabSize={2}
      renderMarkdown
      empty="Nothing open"
      scrollMemory={scrollMemory}
      onOpenFile={onOpenFile}
    />
  );
}

describe("FileViewer anchors", () => {
  let scrolled: Element[];

  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });

  afterEach(cleanup);

  it("opens the linked file and lands on its heading", () => {
    const onOpenFile = vi.fn();
    const memory = new Map([["QUICKSTART.md", 900]]);
    const { rerender } = render(viewer("README.md", "[note](QUICKSTART.md#headless)", onOpenFile, memory));
    fireEvent.click(screen.getByRole("link", { name: "note" }));
    expect(onOpenFile).toHaveBeenCalledWith("QUICKSTART.md");

    rerender(viewer("QUICKSTART.md", "intro\n\n## Headless", onOpenFile, memory));
    expect(scrolled).toEqual([screen.getByRole("heading", { name: "Headless" })]);
  });

  it("restores the remembered offset when the link names no heading", () => {
    const onOpenFile = vi.fn();
    const memory = new Map([["QUICKSTART.md", 900]]);
    const { rerender, container } = render(viewer("README.md", "[note](QUICKSTART.md)", onOpenFile, memory));
    fireEvent.click(screen.getByRole("link", { name: "note" }));
    rerender(viewer("QUICKSTART.md", "## Headless", onOpenFile, memory));
    expect(scrolled).toEqual([]);
    expect((container.querySelector(".files-md") as HTMLElement).scrollTop).toBe(900);
  });

  it("scrolls within the file when the link names its own heading", () => {
    const onOpenFile = vi.fn();
    render(viewer("docs/guide.md", "[here](guide.md#setup)\n\n## Setup", onOpenFile));
    fireEvent.click(screen.getByRole("link", { name: "here" }));
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(scrolled).toEqual([screen.getByRole("heading", { name: "Setup" })]);
  });
});
