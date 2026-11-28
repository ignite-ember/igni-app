/** What a card says, built once for a toast and a row alike. */
import { describe, expect, it } from "vitest";

import type { ModelToast } from "../clientState";
import { CategoryFilter } from "./categoryFilter";
import type { FloorNotification } from "./model";
import { IGNI_SOURCE, NotificationCard, relativeTime } from "./notificationCard";

const NOW = Date.parse("2026-11-28T12:00:00Z");

function row(over: Partial<FloorNotification> = {}): FloorNotification {
  return {
    id: "n1",
    origin: "server",
    source: "acme.review",
    kind: "approval",
    title: "Approve the deploy",
    body: "prod, 3 services",
    actor: "Ada",
    target: { page: "session", params: { session_id: "s1" } },
    created_at: new Date(NOW - 10 * 60_000).toISOString(),
    read: false,
    ...over,
  };
}

function toast(over: Partial<ModelToast> = {}): ModelToast {
  return { id: "t1", text: "Title", kind: "info", ...over };
}

describe("a floor row's card", () => {
  it("says its category, words, source, actor and when", () => {
    const card = NotificationCard.fromFloor(row({ org_name: "Acme" }), "Review", true, NOW);
    expect(card.category.key).toBe("approval");
    expect(card.title).toBe("Approve the deploy");
    expect(card.body).toBe("prod, 3 services");
    expect(card.source).toBe("Review");
    expect(card.org).toBe("Acme");
    expect(card.actor).toBe("Ada");
    expect(card.when).toBe("10m ago");
    expect(card.unread).toBe(true);
    expect(card.severity).toBe("info");
  });

  it("falls back to its kind for a title, and leaves out an actor who is the source", () => {
    const card = NotificationCard.fromFloor(row({ title: "", actor: "Review" }), "Review", true, NOW);
    expect(card.title).toBe("approval");
    expect(card.actor).toBe("");
    expect(card.org).toBe("");
  });

  it("carries a button only for an actionable category it can open", () => {
    expect(NotificationCard.fromFloor(row(), "R", true, NOW).action).toBe("Review");
    expect(NotificationCard.fromFloor(row({ kind: "process_failed" }), "R", true, NOW).action).toBe("Open chat");
    expect(NotificationCard.fromFloor(row({ kind: "release" }), "R", true, NOW).action).toBe("Open");
    expect(NotificationCard.fromFloor(row({ kind: "comment" }), "R", true, NOW).action).toBe("");
    expect(NotificationCard.fromFloor(row(), "R", false, NOW).action).toBe("");
    expect(NotificationCard.fromFloor(row({ target: null }), "R", true, NOW).action).toBe("");
  });

  it("is prominent while it waits on you unread, and quiet once read", () => {
    expect(NotificationCard.fromFloor(row(), "R", true, NOW).prominent).toBe(true);
    expect(NotificationCard.fromFloor(row({ read: true }), "R", true, NOW).prominent).toBe(false);
    expect(NotificationCard.fromFloor(row({ kind: "process_failed" }), "R", true, NOW).prominent).toBe(false);
  });
});

describe("a toast's card", () => {
  it("is igni's when no extension showed it, and always fresh and unread", () => {
    const card = NotificationCard.fromToast(toast({ body: "B" }));
    expect(card.source).toBe(IGNI_SOURCE);
    expect(card.body).toBe("B");
    expect(card.when).toBe("now");
    expect(card.unread).toBe(true);
    expect(card.category.key).toBe("notice");
  });

  it("names the extension that showed it, and has no body when given none", () => {
    const card = NotificationCard.fromToast(toast({ source: "acme.idx", body: null }), (id) => `<${id}>`);
    expect(card.source).toBe("<acme.idx>");
    expect(card.body).toBe("");
    expect(card.category.key).toBe("extension");
  });

  it("carries a button whenever it points somewhere, labelled by its category", () => {
    const schedule = { kind: "schedule", label: "Scheduled tasks" };
    expect(NotificationCard.fromToast(toast({ target: schedule, category: "background" })).action).toBe("View");
    expect(NotificationCard.fromToast(toast({ target: { kind: "session", label: "x" }, category: "failed" })).action).toBe(
      "Open chat",
    );
    expect(NotificationCard.fromToast(toast({ target: schedule })).action).toBe("Open");
    expect(NotificationCard.fromToast(toast()).action).toBe("");
  });

  it("is prominent when it waits on you", () => {
    expect(NotificationCard.fromToast(toast({ category: "approval" })).prominent).toBe(true);
    expect(NotificationCard.fromToast(toast({ category: "failed" })).prominent).toBe(false);
  });

  it("keeps its severity from its kind", () => {
    expect(NotificationCard.fromToast(toast({ kind: "warning" })).severity).toBe("warning");
    expect(NotificationCard.fromToast(toast({ kind: "nonsense" })).severity).toBe("info");
  });
});

describe("its hue", () => {
  it("is its category's token", () => {
    expect(NotificationCard.fromToast(toast({ category: "people" })).hue).toBe("var(--notify-hue-people)");
    expect(NotificationCard.fromFloor(row(), "R", true, NOW).hue).toBe("var(--notify-hue-approval)");
  });

  it("is the warning's for a warning with no category of its own", () => {
    expect(NotificationCard.fromToast(toast({ kind: "warning" })).hue).toBe("var(--warning)");
    expect(NotificationCard.fromToast(toast({ kind: "warning", source: "acme" })).hue).toBe("var(--warning)");
    expect(NotificationCard.fromToast(toast({ kind: "warning", category: "background" })).hue).toBe(
      "var(--notify-hue-background)",
    );
    expect(NotificationCard.fromToast(toast({ kind: "info", source: "acme" })).hue).toBe("var(--notify-hue-extension)");
  });
});

describe("relative time", () => {
  it("counts just now, minutes, hours and days, and nothing for no date", () => {
    const ago = (ms: number) => new Date(NOW - ms).toISOString();
    expect(relativeTime(ago(30_000), NOW)).toBe("just now");
    expect(relativeTime(ago(89_000), NOW)).toBe("just now");
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe("5m ago");
    expect(relativeTime(ago(2 * 3_600_000), NOW)).toBe("2h ago");
    expect(relativeTime(ago(3 * 86_400_000), NOW)).toBe("3d ago");
    expect(relativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe("just now");
    expect(relativeTime("x", NOW)).toBe("");
    expect(relativeTime(null, NOW)).toBe("");
  });
});

describe("the category filter", () => {
  const rows = [
    row({ id: "a", kind: "approval" }),
    row({ id: "b", kind: "comment" }),
    row({ id: "c", kind: "approval", read: true }),
    row({ id: "d", kind: "acme.thing" }),
  ];

  it("has a chip per category present, in the registry's order, with counts", () => {
    const chips = new CategoryFilter(rows).chips().map((c) => [c.category.key, c.count]);
    expect(chips).toEqual([
      ["approval", 2],
      ["people", 1],
      ["extension", 1],
    ]);
  });

  it("keeps the rows of the chosen category, every row for none", () => {
    expect(CategoryFilter.apply(rows, "approval").map((r) => r.id)).toEqual(["a", "c"]);
    expect(CategoryFilter.apply(rows, "failed")).toEqual([]);
    expect(CategoryFilter.apply(rows, null).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("lets go of a category once no row is in it", () => {
    const filter = new CategoryFilter(rows);
    expect(filter.active("people")).toBe("people");
    expect(filter.active("failed")).toBeNull();
    expect(filter.active(null)).toBeNull();
  });
});
