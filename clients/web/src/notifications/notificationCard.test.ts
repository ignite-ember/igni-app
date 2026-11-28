/** What a card says, built once for a toast and a row alike. */
import { describe, expect, it } from "vitest";

import type { ModelToast } from "../clientState";
import { NotificationCategories } from "./categories";
import { CategoryFilter } from "./categoryFilter";
import type { FloorNotification } from "./model";
import { IGNI_SOURCE, NotificationCard, relativeTime } from "./notificationCard";
import { actionWorld } from "./testing";

const NOW = Date.parse("2026-11-28T12:00:00Z");
const NPM = { requirement_id: "r1", tool_name: "bash", friendly_name: "npm install" };

function row(over: Partial<FloorNotification> = {}): FloorNotification {
  return {
    id: "n1",
    origin: "server",
    source: "acme.review",
    kind: "comment",
    title: "Ada commented",
    body: "On step 3",
    actor: "Ada",
    target: { page: "session", params: { session_id: "cv" } },
    created_at: new Date(NOW - 10 * 60_000).toISOString(),
    read: false,
    ...over,
  };
}

function toast(over: Partial<ModelToast> = {}): ModelToast {
  return { id: "t1", text: "Title", kind: "info", ...over };
}

const pending = actionWorld({ approvals: [NPM] }).actions;
const idle = actionWorld().actions;

describe("a floor row's card", () => {
  it("says its category, words, source, actor and when", () => {
    const r = row({ org_name: "Acme" });
    const card = NotificationCard.fromFloor(r, "Review", idle.forFloor(r), NOW);
    expect(card.category.key).toBe("people");
    expect(card.title).toBe("Ada commented");
    expect(card.body).toBe("On step 3");
    expect(card.source).toBe("Review");
    expect(card.org).toBe("Acme");
    expect(card.actor).toBe("Ada");
    expect(card.when).toBe("10m ago");
    expect(card.unread).toBe(true);
    expect(card.severity).toBe("info");
    expect(card.action?.label).toBe("Open chat ‘CV review’");
  });

  it("falls back to its kind for a title, and leaves out an actor who is the source", () => {
    const card = NotificationCard.fromFloor(row({ title: "", actor: "Review" }), "Review", null, NOW);
    expect(card.title).toBe("comment");
    expect(card.actor).toBe("");
    expect(card.org).toBe("");
  });

  it("is a prominent decision only while one waits, and draws its button", () => {
    const r = row({ kind: "approval" });
    const live = NotificationCard.fromFloor(r, "R", pending.forFloor(r), NOW);
    expect(live.category.key).toBe("approval");
    expect(live.prominent).toBe(true);
    expect(live.button).toBe(true);

    const gone = NotificationCard.fromFloor(r, "R", idle.forFloor(r), NOW);
    expect(gone.category.key).not.toBe("approval");
    expect(gone.prominent).toBe(false);
    // The chat is still there, so it may still be opened — but not as a decision.
    expect(gone.button).toBe(true);
    expect(gone.action?.decides).toBe(false);
  });

  it("draws a button for whatever it reaches, and none when it reaches nothing", () => {
    const failed = row({ kind: "process_failed" });
    const release = row({ kind: "release" });
    expect(NotificationCard.fromFloor(failed, "R", idle.forFloor(failed), NOW).button).toBe(true);
    expect(NotificationCard.fromFloor(release, "R", idle.forFloor(release), NOW).button).toBe(true);
    // A row that points nowhere has no action, so no button.
    const nowhere = row({ target: null });
    expect(NotificationCard.fromFloor(nowhere, "R", idle.forFloor(nowhere), NOW).button).toBe(false);
    expect(NotificationCard.fromFloor(failed, "R", null, NOW).button).toBe(false);
  });
});

describe("a toast's card", () => {
  it("is igni's when no extension showed it, and always fresh and unread", () => {
    const card = NotificationCard.fromToast(toast({ body: "B" }), null);
    expect(card.source).toBe(IGNI_SOURCE);
    expect(card.body).toBe("B");
    expect(card.when).toBe("now");
    expect(card.unread).toBe(true);
    expect(card.category.key).toBe("notice");
    expect(card.button).toBe(false);
  });

  it("names the extension that showed it, and has no body when given none", () => {
    const card = NotificationCard.fromToast(toast({ source: "acme.idx", body: null }), null, (id) => `<${id}>`);
    expect(card.source).toBe("<acme.idx>");
    expect(card.body).toBe("");
    expect(card.category.key).toBe("extension");
  });

  it("draws a button whenever it reaches something", () => {
    const t = toast({ target: { kind: "session", label: "x", params: { session_id: "cv" } } });
    expect(NotificationCard.fromToast(t, idle.forToast(t)).button).toBe(true);
    expect(NotificationCard.fromToast(t, null).button).toBe(false);
  });

  it("keeps its severity from its kind", () => {
    expect(NotificationCard.fromToast(toast({ kind: "warning" }), null).severity).toBe("warning");
    expect(NotificationCard.fromToast(toast({ kind: "nonsense" }), null).severity).toBe("info");
  });
});

describe("its hue", () => {
  it("is its category's token", () => {
    expect(NotificationCard.fromToast(toast({ category: "people" }), null).hue).toBe("var(--notify-hue-people)");
    const r = row({ kind: "approval" });
    expect(NotificationCard.fromFloor(r, "R", pending.forFloor(r), NOW).hue).toBe("var(--notify-hue-approval)");
  });

  it("is the warning's for a warning with no category of its own", () => {
    expect(NotificationCard.fromToast(toast({ kind: "warning" }), null).hue).toBe("var(--warning)");
    expect(NotificationCard.fromToast(toast({ kind: "warning", source: "acme" }), null).hue).toBe("var(--warning)");
    expect(NotificationCard.fromToast(toast({ kind: "warning", category: "background" }), null).hue).toBe(
      "var(--notify-hue-background)",
    );
    expect(NotificationCard.fromToast(toast({ kind: "info", source: "acme" }), null).hue).toBe(
      "var(--notify-hue-extension)",
    );
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
    row({ id: "a", kind: "process_failed", target: null }),
    row({ id: "b", kind: "comment", target: null }),
    row({ id: "c", kind: "error", read: true, target: null }),
    row({ id: "d", kind: "acme.thing", target: null }),
  ];

  it("has a chip per category present, in the registry's order, with counts", () => {
    const chips = new CategoryFilter(rows).chips().map((c) => [c.category.key, c.count]);
    expect(chips).toEqual([
      ["failed", 2],
      ["people", 1],
      ["extension", 1],
    ]);
  });

  it("places rows the way their cards are, a waiting decision included", () => {
    const approval = row({ id: "e", kind: "review_requested", target: { page: "session", params: { session_id: "cv" } } });
    const all = [...rows, approval];
    const live = new CategoryFilter(all, (r) => NotificationCategories.forFloor(r, pending.forFloor(r)));
    expect(live.chips().map((c) => c.category.key)).toEqual(["approval", "failed", "people", "extension"]);
    const settled = new CategoryFilter(all, (r) => NotificationCategories.forFloor(r, idle.forFloor(r)));
    expect(settled.chips().map((c) => c.category.key)).toEqual(["failed", "people", "extension"]);
  });

  it("keeps the rows of the chosen category, every row for none", () => {
    const filter = new CategoryFilter(rows);
    expect(filter.apply(rows, "failed").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filter.apply(rows, "update")).toEqual([]);
    expect(filter.apply(rows, null).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("lets go of a category once no row is in it", () => {
    const filter = new CategoryFilter(rows);
    expect(filter.active("people")).toBe("people");
    expect(filter.active("update")).toBeNull();
    expect(filter.active(null)).toBeNull();
  });
});
