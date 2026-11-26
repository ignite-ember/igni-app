// @vitest-environment jsdom
/**
 * Tests for following links in a rendered markdown file: a ``#heading``
 * link scrolls to its heading and never touches the window's location,
 * and a link into another file carries its heading along.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileMarkdown } from "./FileMarkdown";

const DOC = [
  "See [the headless note](#a-headless-run-cannot-ask-you-anything) and [the guide](guide.md#install).",
  "",
  "## A headless run cannot ask you anything",
].join("\n");

describe("FileMarkdown links", () => {
  let scrolled: Element[];

  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });

  afterEach(() => {
    cleanup();
    window.location.hash = "";
  });

  it("gives a heading GitHub's anchor, under the sanitizer's prefix", () => {
    render(<FileMarkdown text={DOC} />);
    const heading = screen.getByRole("heading", { name: "A headless run cannot ask you anything" });
    expect(heading.id).toBe("user-content-a-headless-run-cannot-ask-you-anything");
  });

  it("scrolls to the heading a #link names, leaving the location alone", () => {
    render(
      <div className="files-md">
        <FileMarkdown text={DOC} />
      </div>,
    );
    fireEvent.click(screen.getByRole("link", { name: "the headless note" }));
    expect(scrolled).toEqual([screen.getByRole("heading", { name: "A headless run cannot ask you anything" })]);
    expect(window.location.hash).toBe("");
  });

  it("opens another file with the heading its link names", () => {
    const onOpenFile = vi.fn();
    render(<FileMarkdown text={DOC} baseDir="docs" onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByRole("link", { name: "the guide" }));
    expect(onOpenFile).toHaveBeenCalledWith("docs/guide.md", "install");
  });

  it("opens another file with no heading when its link names none", () => {
    const onOpenFile = vi.fn();
    render(<FileMarkdown text="[x](guide.md)" onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByRole("link", { name: "x" }));
    expect(onOpenFile).toHaveBeenCalledWith("guide.md", undefined);
  });
});
