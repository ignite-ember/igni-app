/**
 * Tests for deriving the file tree from the flat path list.
 *
 * The cases that matter are the ones the flat list makes non-obvious:
 * one folder level is the distinct next segment under a prefix (so a
 * folder with ten files is one row, not ten), folders lead files, the
 * search box is both a path browser and a global find depending on
 * whether it holds a ``/``, and a dotfile still sorts into place.
 */

import { describe, expect, it } from "vitest";

import { browse, dirExists, entriesFor, findFiles, parentDir, readQuery, subsequence } from "./fileTree";

const PATHS = [
  "alembic.ini",
  "CHANGELOG.md",
  ".coverage",
  "app/__init__.py",
  "app/config.py",
  "app/api/routes.py",
  "app/api/deps.py",
  "app/db/models.py",
  "tools/build.py",
];

describe("browse", () => {
  it("lists one folder's immediate children, folders first then files", () => {
    const rows = browse(PATHS, "");
    expect(rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "dir:app",
      "dir:tools",
      "file:.coverage",
      "file:alembic.ini",
      "file:CHANGELOG.md",
    ]);
  });

  it("collapses a subfolder's files to a single folder row", () => {
    const rows = browse(PATHS, "app");
    expect(rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "dir:api",
      "dir:db",
      "file:__init__.py",
      "file:config.py",
    ]);
  });

  it("gives a descended folder row its full project-relative path", () => {
    const api = browse(PATHS, "app").find((r) => r.name === "api");
    expect(api?.path).toBe("app/api");
  });
});

describe("parentDir / dirExists", () => {
  it("walks up one level, bottoming out at the root", () => {
    expect(parentDir("app/api")).toBe("app");
    expect(parentDir("app")).toBe("");
    expect(parentDir("")).toBe("");
  });

  it("knows a real folder from a typo", () => {
    expect(dirExists(PATHS, "app/api")).toBe(true);
    expect(dirExists(PATHS, "")).toBe(true);
    expect(dirExists(PATHS, "nope")).toBe(false);
  });
});

describe("subsequence", () => {
  it("matches gaps but keeps order", () => {
    expect(subsequence("config.py", "cfg")).toBe(true);
    expect(subsequence("config.py", "gfc")).toBe(false);
    expect(subsequence("anything", "")).toBe(true);
  });
});

describe("findFiles", () => {
  it("ranks a name-prefix hit above a mere subsequence, and caps", () => {
    const { rows, capped } = findFiles(PATHS, "config", 10);
    expect(rows[0].path).toBe("app/config.py");
    expect(capped).toBe(false);
  });

  it("reports when the result is cut to the limit", () => {
    const { rows, capped } = findFiles(PATHS, "py", 2);
    expect(rows).toHaveLength(2);
    expect(capped).toBe(true);
  });
});

describe("readQuery", () => {
  it("treats a slash as a path and no-slash text as a global find", () => {
    expect(readQuery("")).toEqual({ dir: "", term: "", mode: "browse" });
    expect(readQuery("app/")).toEqual({ dir: "app", term: "", mode: "browse" });
    expect(readQuery("app/con")).toEqual({ dir: "app", term: "con", mode: "browse" });
    expect(readQuery("config")).toEqual({ dir: "", term: "config", mode: "find" });
  });

  it("ignores a leading slash so /app and app browse the same folder", () => {
    expect(readQuery("/app/")).toEqual({ dir: "app", term: "", mode: "browse" });
  });
});

describe("entriesFor", () => {
  it("browses a folder filtered by the trailing term", () => {
    const { rows } = entriesFor(PATHS, "app/con", 50);
    expect(rows.map((r) => r.name)).toEqual(["config.py"]);
  });

  it("finds across the whole project when the box holds no slash", () => {
    const { rows } = entriesFor(PATHS, "routes", 50);
    expect(rows.map((r) => r.path)).toContain("app/api/routes.py");
  });
});
