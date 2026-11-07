import { describe, expect, it, vi } from "vitest";

import { MENTION_PAGE_SIZE, MentionCompleter, STALE, moveActive, type MentionMenu } from "./completionMenu";

type Lookup = (q: string, limit?: number) => Promise<{ matches: string[]; total: number }>;

function completer(lookup: Lookup) {
  const completeFiles = vi.fn<Lookup>(lookup);
  return { completer: new MentionCompleter({ completeFiles }), completeFiles };
}

const files = (n: number) => Array.from({ length: n }, (_, i) => `f${i}.ts`);

describe("MentionCompleter", () => {
  it("builds a menu from the first page of matches", async () => {
    const { completer: c, completeFiles } = completer(async () => ({ matches: ["a.ts"], total: 1 }));

    const menu = await c.query("a", 4);

    expect(completeFiles).toHaveBeenCalledWith("a", MENTION_PAGE_SIZE);
    expect(menu).toMatchObject({ kind: "mention", tokenStart: 4, query: "a", total: 1, active: 0 });
  });

  it("no matches, or a failed lookup, is no menu", async () => {
    expect(await completer(async () => ({ matches: [], total: 0 })).completer.query("z", 0)).toBeNull();
    expect(
      await completer(async () => {
        throw new Error("index not ready");
      }).completer.query("z", 0),
    ).toBeNull();
  });

  it("an answer that arrives after cancel() is stale", async () => {
    let release: () => void = () => {};
    const { completer: c } = completer(async () => {
      await new Promise<void>((r) => (release = r));
      return { matches: ["a.ts"], total: 1 };
    });

    const pending = c.query("a", 0);
    c.cancel();
    release();

    expect(await pending).toBe(STALE);
  });

  it("an older lookup is overtaken by a newer one", async () => {
    const releases: (() => void)[] = [];
    const { completer: c } = completer(async (q) => {
      await new Promise<void>((r) => releases.push(r));
      return { matches: [q], total: 1 };
    });

    const older = c.query("a", 0);
    const newer = c.query("ab", 0);
    releases.forEach((r) => r());

    expect(await older).toBe(STALE);
    expect(await newer).toMatchObject({ query: "ab" });
  });

  describe("loadMore", () => {
    const menuOf = (entries: number, total: number): MentionMenu => ({
      kind: "mention",
      entries: files(entries).map((f) => ({ key: f, label: f })),
      active: 3,
      tokenStart: 0,
      total,
      limit: MENTION_PAGE_SIZE,
      query: "f",
    });

    it("asks for one more page of the same query, keeping the highlight", async () => {
      const { completer: c, completeFiles } = completer(async (_q, limit = 0) => ({
        matches: files(limit),
        total: 450,
      }));

      const next = await c.loadMore(menuOf(200, 450));

      expect(completeFiles).toHaveBeenCalledWith("f", 2 * MENTION_PAGE_SIZE);
      expect(next).toMatchObject({ limit: 400, total: 450, active: 3 });
      expect(next !== STALE && next.entries).toHaveLength(400);
    });

    it("does nothing once everything is loaded", async () => {
      const { completer: c, completeFiles } = completer(async () => ({ matches: [], total: 0 }));

      expect(await c.loadMore(menuOf(5, 5))).toBe(STALE);
      expect(completeFiles).not.toHaveBeenCalled();
    });

    it("asks once while a load is still running", async () => {
      let release: () => void = () => {};
      const { completer: c, completeFiles } = completer(async () => {
        await new Promise<void>((r) => (release = r));
        return { matches: files(400), total: 450 };
      });

      const first = c.loadMore(menuOf(200, 450));
      expect(await c.loadMore(menuOf(200, 450))).toBe(STALE);
      release();
      await first;

      expect(completeFiles).toHaveBeenCalledOnce();
    });

    it("a failed load keeps the menu as it is", async () => {
      const { completer: c } = completer(async () => {
        throw new Error("offline");
      });

      expect(await c.loadMore(menuOf(200, 450))).toBe(STALE);
    });
  });
});

describe("moveActive", () => {
  it("wraps at both ends", () => {
    const menu = { kind: "slash" as const, entries: [{ key: "a", label: "a" }, { key: "b", label: "b" }], active: 0, tokenStart: 0 as const };

    expect(moveActive(menu, -1).active).toBe(1);
    expect(moveActive(menu, 1).active).toBe(1);
    expect(moveActive(moveActive(menu, 1), 1).active).toBe(0);
  });
});
