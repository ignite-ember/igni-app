import { describe, expect, it } from "vitest";

import { SessionRow } from "./sessionRow";

describe("SessionRow", () => {
  it("reads a row under either id key and either timestamp", () => {
    expect(SessionRow.parse({ session_id: "s1", name: "A", updated_at: 10 })).toEqual(
      new SessionRow("s1", "A", 10),
    );
    expect(SessionRow.parse({ id: "s2", created_at: "20" })).toEqual(new SessionRow("s2", "", 20));
    expect(SessionRow.parse(null)).toEqual(new SessionRow("", "", 0));
  });

  it("lists a wrapped answer and a bare one", () => {
    expect(SessionRow.listFrom({ sessions: [{ id: "a" }] }).map((r) => r.sessionId)).toEqual(["a"]);
    expect(SessionRow.listFrom([{ id: "b" }]).map((r) => r.sessionId)).toEqual(["b"]);
    expect(SessionRow.listFrom(null)).toEqual([]);
    expect(SessionRow.listFrom({ sessions: "nope" })).toEqual([]);
  });

  it("names an entry by its name, else by when it was last used, else by its id", () => {
    expect(new SessionRow("s1", "Named", 0).toEntry()).toEqual({
      session_id: "s1",
      name: "Named",
      detail: "s1",
    });
    expect(new SessionRow("s1", "", 0).toEntry().name).toBe("s1");
    const dated = new SessionRow("s1", "", 1_700_000_000).toEntry();
    expect(dated.name).toMatch(/^Chat · /);
    expect(dated.detail).toMatch(/^s1 · /);
  });
});
