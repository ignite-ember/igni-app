// @vitest-environment jsdom
/**
 * The help page: every command, grouped, each one dropped into the
 * composer on a click, and a search over names and descriptions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { HelpPage } from "./HelpPage";

afterEach(cleanup);

const skills = [{ name: "/release-notes", description: "Draft the release notes" }];

function page(withSkills = skills) {
  const onRun = vi.fn();
  render(<HelpPage skills={withSkills} onRun={onRun} onClose={() => {}} />);
  return onRun;
}

const titles = () => [...document.querySelectorAll(".help-group-title")].map((h) => h.textContent);

describe("the help page", () => {
  it("lists the groups, then the skills", () => {
    page();
    expect(titles()[0]).toBe("This conversation");
    expect(titles().at(-1)).toBe("Skills");
    expect(screen.getByText("Draft the release notes")).toBeTruthy();
  });

  it("leaves out the skills section when there are none", () => {
    page([]);
    expect(titles()).not.toContain("Skills");
  });

  it("drops a command or a skill into the composer on a click", () => {
    const onRun = page();
    fireEvent.click(screen.getByRole("button", { name: /\/clear/ }));
    expect(onRun).toHaveBeenCalledWith("/clear");
    fireEvent.click(screen.getByRole("button", { name: /\/release-notes/ }));
    expect(onRun).toHaveBeenCalledWith("/release-notes");
  });

  it("searches names and descriptions, hiding groups with nothing left", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Search commands" }));
    const search = screen.getByPlaceholderText("Search commands…");
    fireEvent.change(search, { target: { value: "SCHED" } });
    expect(screen.getByRole("button", { name: /\/schedule/ })).toBeTruthy();
    expect(titles()).toEqual(["Running work"]);
    fireEvent.change(search, { target: { value: "release notes" } });
    expect(titles()).toEqual(["Skills"]);
    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.getByText("No commands match")).toBeTruthy();
    expect(titles()).toEqual([]);
  });
});
