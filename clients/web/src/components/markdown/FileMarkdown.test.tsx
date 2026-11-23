/**
 * Tests for resolving a markdown link to a project file.
 *
 * The case that matters: a link like ``../docs/x.md`` in a file two
 * folders deep names a real project path once ``.`` and ``..`` collapse,
 * so clicking it can open that file in the viewer instead of a browser.
 */

import { describe, expect, it } from "vitest";

import { resolveProjectPath } from "./FileMarkdown";

describe("resolveProjectPath", () => {
  it("resolves a sibling link against the file's folder", () => {
    expect(resolveProjectPath("clients", "README.md")).toBe("clients/README.md");
  });

  it("collapses .. to climb out of the folder", () => {
    expect(resolveProjectPath("clients/web", "../tauri/README.md")).toBe("clients/tauri/README.md");
  });

  it("collapses a leading ./", () => {
    expect(resolveProjectPath("docs", "./guide.md")).toBe("docs/guide.md");
  });

  it("treats a leading slash as project-root-relative", () => {
    expect(resolveProjectPath("deep/nested", "/CONTRIBUTING.md")).toBe("CONTRIBUTING.md");
  });

  it("drops a #fragment and ?query when naming the file", () => {
    expect(resolveProjectPath("docs", "guide.md#install")).toBe("docs/guide.md");
  });

  it("resolves from the project root when the file is at the top", () => {
    expect(resolveProjectPath("", "SECURITY.md")).toBe("SECURITY.md");
  });
});
