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
      has_paused_run: false,
    });
    expect(new SessionRow("s1", "", 0).toEntry().name).toBe("s1");
    const dated = new SessionRow("s1", "", 1_700_000_000).toEntry();
    expect(dated.name).toMatch(/^Chat · /);
    expect(dated.detail).toMatch(/^s1 · /);
  });

  it("reads the flag that says a run is waiting for the person", () => {
    // The backend sends it with every row of ``list_sessions``.
    expect(SessionRow.parse({ session_id: "s1", has_paused_run: true }).hasPausedRun).toBe(true);
    expect(SessionRow.parse({ session_id: "s1", has_paused_run: true }).toEntry().has_paused_run).toBe(
      true,
    );
  });

  it("reads a backend that does not send the flag as no run waiting", () => {
    // Older backends omit it entirely. That is not a session with a
    // paused run; it is a session whose state we do not know.
    expect(SessionRow.parse({ session_id: "s1" }).hasPausedRun).toBe(false);
    expect(SessionRow.parse({ session_id: "s1" }).toEntry().has_paused_run).toBe(false);
    // And a flag that is not a plain true is not a waiting run either.
    expect(SessionRow.parse({ session_id: "s1", has_paused_run: "true" }).hasPausedRun).toBe(false);
    expect(SessionRow.parse({ session_id: "s1", has_paused_run: 1 }).hasPausedRun).toBe(false);
    expect(SessionRow.parse({ session_id: "s1", has_paused_run: null }).hasPausedRun).toBe(false);
  });
});
