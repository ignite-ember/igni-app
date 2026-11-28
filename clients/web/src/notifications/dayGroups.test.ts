import { describe, expect, it } from "vitest";

import { NotificationDays } from "./dayGroups";
import type { FloorNotification } from "./model";

const NOW = new Date(2026, 10, 28, 15, 0);

function row(id: string, created_at: string | null): FloorNotification {
  return {
    id,
    origin: "server",
    source: "x",
    kind: "k",
    title: id,
    body: "",
    actor: "",
    target: null,
    created_at,
    read: false,
  };
}

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

describe("NotificationDays", () => {
  const days = new NotificationDays(NOW, "en-GB");

  it("groups by local day, newest day first, keeping order within a day", () => {
    const groups = days.group([
      row("a", at(2026, 10, 28, 14)),
      row("b", at(2026, 10, 27, 9)),
      row("c", at(2026, 10, 28, 1)),
      row("d", at(2026, 10, 25)),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Wednesday"]);
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([["a", "c"], ["b"], ["d"]]);
    expect(groups.map((g) => g.key)).toEqual(["2026-11-28", "2026-11-27", "2026-11-25"]);
  });

  it("names days within the week by weekday, older ones by date", () => {
    const start = (d: number, m = 10, y = 2026) => new Date(y, m, d).getTime();
    expect(days.label(start(28))).toBe("Today");
    expect(days.label(start(27))).toBe("Yesterday");
    expect(days.label(start(22))).toBe("Sunday");
    expect(days.label(start(21))).toMatch(/21 Nov/);
    expect(days.label(start(21))).not.toMatch(/2026/);
    expect(days.label(start(3, 11, 2025))).toMatch(/2025/);
  });

  it("calls anything from the future today", () => {
    expect(days.label(new Date(2026, 10, 29).getTime())).toBe("Today");
  });

  it("puts rows it cannot date last, as Earlier", () => {
    const groups = days.group([row("x", null), row("y", "nonsense"), row("a", at(2026, 9, 1))]);
    expect(groups.map((g) => g.label).at(-1)).toBe("Earlier");
    expect(groups.at(-1)?.rows.map((r) => r.id)).toEqual(["x", "y"]);
    expect(groups.at(-1)?.key).toBe("undated");
  });

  it("has no groups for no rows", () => {
    expect(days.group([])).toEqual([]);
  });

  it("defaults to now", () => {
    expect(new NotificationDays().group([row("a", new Date().toISOString())])[0].label).toBe("Today");
  });
});
