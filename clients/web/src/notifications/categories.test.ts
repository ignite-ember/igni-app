/**
 * Every notification falls into exactly one category, decided in one
 * place: each source igni raises, each floor kind, each toast. And
 * every category can be drawn: a hue token in each theme block.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { NotificationCategories } from "./categories";
import type { CategoryKey } from "./category";
import { PushNotice } from "./pushNotice";
import { actionWorld } from "./testing";

const key = (kind: string) => NotificationCategories.forFloor({ kind }).key;

describe("the registry", () => {
  it("is the closed set of eight, each once", () => {
    expect(NotificationCategories.ALL.map((c) => c.key)).toEqual([
      "approval",
      "failed",
      "done",
      "background",
      "people",
      "update",
      "extension",
      "notice",
    ]);
  });

  it("finds a category by its key, and nothing for a key that is not one", () => {
    expect(NotificationCategories.find("failed")?.label).toBe("Failed");
    expect(NotificationCategories.find("bogus")).toBeNull();
    expect(NotificationCategories.find(null)).toBeNull();
    expect(NotificationCategories.find(undefined)).toBeNull();
  });

  it("makes only approval wait on the person", () => {
    expect(NotificationCategories.ALL.filter((c) => c.needsYou).map((c) => c.key)).toEqual(["approval"]);
  });

  it("styles failures as errors and finished work as successes", () => {
    const severities = Object.fromEntries(NotificationCategories.ALL.map((c) => [c.key, c.severity]));
    expect(severities).toEqual({
      approval: "info",
      failed: "error",
      done: "success",
      background: "info",
      people: "info",
      update: "info",
      extension: "info",
      notice: "info",
    });
  });
});

describe("igni's own notices", () => {
  it("files a finished background process under background, a failed one under failed", () => {
    const ok = PushNotice.backgroundProcessDone({ channel: "background_process_done", cmd: "make", exitCode: 0 });
    const bad = PushNotice.backgroundProcessDone({ channel: "background_process_done", cmd: "make", exitCode: 2 });
    expect(ok.toNotify().category).toBe("background");
    expect(bad.toNotify().category).toBe("failed");
  });

  it("files a scheduled task, started or completed, under background", () => {
    for (const channel of ["scheduler_started", "scheduler_completed"] as const) {
      const n = PushNotice.scheduler({ channel, description: "d", result: "", taskId: "t" });
      expect(n.toNotify().category).toBe("background");
    }
  });
});

describe("a floor row, by its kind", () => {
  it.each<[string, CategoryKey]>([
    ["comment", "people"],
    ["mention", "people"],
    ["chat.message", "people"],
    ["export_ready", "done"],
    ["export.ready", "done"],
    ["done", "done"],
    ["ci", "done"],
    ["scheduler_completed", "background"],
    ["workflow", "background"],
    ["watcher-fired", "background"],
    ["release", "update"],
    ["update_available", "update"],
    ["process_failed", "failed"],
    ["error", "failed"],
    ["ci:failed", "failed"],
  ])("%s is %s", (kind, expected) => {
    expect(key(kind)).toBe(expected);
  });

  it.each(["approval", "permission_request", "hitl", "review", "review_requested", "decision", "waiting", "confirm"])(
    "never makes %s a decision on its words alone",
    (kind) => {
      expect(key(kind)).not.toBe("approval");
      expect(key(kind)).toBe("extension");
    },
  );

  it("is a decision only when one is waiting behind it", () => {
    const { actions } = actionWorld({ waiting: ["infra"] });
    const waiting = actions.forFloor({ target: { page: "session", params: { session_id: "infra" } } });
    const idle = actions.forFloor({ target: { page: "session", params: { session_id: "cv" } } });
    expect(NotificationCategories.forFloor({ kind: "comment" }, waiting).key).toBe("approval");
    expect(NotificationCategories.forFloor({ kind: "approval" }, idle).key).toBe("extension");
    expect(NotificationCategories.forToast({ kind: "info", category: "approval" }, idle).key).toBe("notice");
    expect(NotificationCategories.forToast({ kind: "info", category: "approval" }, waiting).key).toBe("approval");
  });

  it("lets a failure outrank what failed", () => {
    expect(key("workflow_failed")).toBe("failed");
    expect(key("review_failed")).toBe("failed");
    expect(key("comment_approval")).toBe("people");
    expect(key("mention_update")).toBe("people");
    expect(key("release_workflow")).toBe("update");
    expect(key("task_completed")).toBe("background");
  });

  it("reads whole words, in any case, not fragments", () => {
    expect(key("ERROR")).toBe("failed");
    expect(key("terrorist_report")).toBe("extension");
    expect(key("cinema")).toBe("extension");
  });

  it("falls to its extension's for a kind it cannot place", () => {
    expect(key("acme.custom")).toBe("extension");
    expect(key("")).toBe("extension");
    expect(NotificationCategories.fromKind(null)).toBeNull();
  });
});

describe("a toast", () => {
  const toast = (over: { kind?: string; category?: string | null; source?: string | null }) =>
    NotificationCategories.forToast({ kind: "info", ...over }).key;

  it("takes the category igni named, but never a decision on its say-so", () => {
    expect(toast({ category: "update" })).toBe("update");
    expect(toast({ category: "approval", kind: "error" })).toBe("failed");
    expect(toast({ category: "approval" })).toBe("notice");
  });

  it("ignores a category that is not one", () => {
    expect(toast({ category: "bogus" })).toBe("notice");
  });

  it("files an extension's by its severity, else under extensions", () => {
    expect(toast({ source: "acme", kind: "error" })).toBe("failed");
    expect(toast({ source: "acme", kind: "success" })).toBe("done");
    expect(toast({ source: "acme", kind: "warning" })).toBe("extension");
    expect(toast({ source: "acme" })).toBe("extension");
  });

  it("files igni's own without a category as an igni notice", () => {
    expect(toast({ source: null })).toBe("notice");
    expect(toast({})).toBe("notice");
  });
});

describe("every category can be drawn in both themes", () => {
  const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "theme.css"), "utf8");
  /** The theme blocks: dark (`:root`), explicit light, and the OS-light fallback. */
  const blocks = {
    dark: css.slice(css.indexOf(":root {"), css.indexOf(":root[data-theme=\"light\"]")),
    light: css.slice(css.indexOf(":root[data-theme=\"light\"]"), css.indexOf("@media (prefers-color-scheme: light)")),
    osLight: css.slice(css.indexOf("@media (prefers-color-scheme: light)"), css.indexOf("* {")),
  };

  it.each(Object.entries(blocks))("defines every hue token in the %s block", (_name, block) => {
    for (const category of NotificationCategories.ALL) {
      expect(block, category.hueToken).toMatch(new RegExp(`${category.hueToken}:\\s*[^;]+;`));
    }
  });

  it("keeps the light hues the same in the explicit and the OS-light blocks", () => {
    for (const category of NotificationCategories.ALL) {
      const value = (block: string) => block.match(new RegExp(`${category.hueToken}:\\s*([^;]+);`))?.[1];
      expect(value(blocks.osLight)).toBe(value(blocks.light));
    }
  });

  it("keeps a failure on the danger red, distinct from every other hue", () => {
    const value = (token: string) => blocks.dark.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1];
    expect(value("--notify-hue-failed")).toBe("var(--danger)");
    const values = NotificationCategories.ALL.map((c) => value(c.hueToken));
    expect(new Set(values).size).toBe(values.length);
    expect(values).not.toContain("var(--warning)");
  });
});
