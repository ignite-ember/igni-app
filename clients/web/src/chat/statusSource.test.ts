import { describe, expect, it, vi } from "vitest";

import { StatusSource } from "./statusSource";

/** A client whose ``rpc`` answers per method, or rejects with an Error. */
function client(answers: Record<string, unknown>) {
  return {
    rpc: vi.fn(async (method: string) => {
      const answer = answers[method];
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
}

describe("StatusSource", () => {
  it("returns the status the backend sent", async () => {
    const status = { model: "m", cloud_email: "a@b" };
    const r = await new StatusSource(client({ get_status: status }) as never).status();
    expect(r).toEqual({ ok: true, status });
  });

  it("returns a null status when the backend answered with nothing", async () => {
    const r = await new StatusSource(client({ get_status: undefined }) as never).status();
    expect(r).toEqual({ ok: true, status: null });
  });

  it("turns a rejection into a failure carrying the reason", async () => {
    const source = new StatusSource(
      client({
        get_status: new Error("disconnected"),
        get_project_dir: new Error("unknown method"),
        list_sessions: new Error("gone"),
        count_context_tokens: new Error("tokenizer not ready"),
      }) as never,
    );
    expect(await source.status()).toEqual({ ok: false, reason: "Error: disconnected" });
    expect(await source.projectDir()).toEqual({ ok: false, reason: "Error: unknown method" });
    expect(await source.sessions()).toEqual({ ok: false, reason: "Error: gone" });
    expect(await source.recountTokens()).toEqual({
      ok: false,
      reason: "Error: tokenizer not ready",
    });
  });

  it("returns the project folder", async () => {
    const r = await new StatusSource(client({ get_project_dir: "/work" }) as never).projectDir();
    expect(r).toEqual({ ok: true, projectDir: "/work" });
  });

  it("lists sessions as the sidebar shows them", async () => {
    const r = await new StatusSource(
      client({ list_sessions: { sessions: [{ session_id: "s-1", name: "First" }] } }) as never,
    ).sessions();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sessions.map((s) => [s.session_id, s.name])).toEqual([["s-1", "First"]]);
  });

  it("reports a recount that ran", async () => {
    const c = client({ count_context_tokens: { tokens: 3 } });
    expect(await new StatusSource(c as never).recountTokens()).toEqual({ ok: true });
    expect(c.rpc).toHaveBeenCalledWith("count_context_tokens");
  });
});
