// @vitest-environment jsdom
/**
 * The named calls on {@link BackendCalls}: the composer's expected
 * failures come back as a Result, never as a rejection, the happy path
 * sends the same wire call the backend has always received, and every
 * answer is parsed rather than trusted.
 */
import { describe, expect, it, vi } from "vitest";

import { BackendCalls } from "./backendCalls";
import { MAX_ATTACHMENT_BYTES } from "./composerWire";

type Rpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** Calls over a transport whose only seam is `rpc`. */
function clientAnswering(rpc: Rpc): { client: BackendCalls; rpc: ReturnType<typeof vi.fn<Rpc>> } {
  const spy = vi.fn<Rpc>(rpc);
  return { client: new BackendCalls({ rpc: spy }), rpc: spy };
}

describe("uploadAttachment", () => {
  it("sends the file base64-encoded and answers with its path", async () => {
    const { client, rpc } = clientAnswering(async () => ({ path: "att/a.txt", size: 3 }));

    const result = await client.uploadAttachment(new File(["abc"], "a.txt"));

    expect(result).toEqual({ ok: true, path: "att/a.txt" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("upload_attachment", {
      filename: "a.txt",
      content_base64: btoa("abc"),
    });
  });

  it("refuses a file over the limit without calling the backend", async () => {
    const { client, rpc } = clientAnswering(async () => ({}));
    const big = new File(["x"], "big.bin");
    Object.defineProperty(big, "size", { value: MAX_ATTACHMENT_BYTES + 1 });

    const result = await client.uploadAttachment(big);

    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports the backend's error instead of ignoring it", async () => {
    const { client } = clientAnswering(async () => ({ error: "disk full" }));

    expect(await client.uploadAttachment(new File(["x"], "a"))).toEqual({
      ok: false,
      reason: "disk full",
    });
  });

  it("an answer without a path is a failure", async () => {
    const { client } = clientAnswering(async () => ({ size: 1 }));

    expect((await client.uploadAttachment(new File(["x"], "a"))).ok).toBe(false);
  });

  it("a call that throws is a failure, not a rejection", async () => {
    const { client } = clientAnswering(async () => {
      throw new Error("socket closed");
    });

    expect(await client.uploadAttachment(new File(["x"], "a"))).toEqual({
      ok: false,
      reason: "socket closed",
    });
  });
});

describe("searchCode", () => {
  it("answers with the matches", async () => {
    const match = { path: "a.py", line: 1, preview: "x" };
    const { client, rpc } = clientAnswering(async () => ({ matches: [match] }));

    expect(await client.searchCode("snip")).toEqual({ ok: true, matches: [match] });
    expect(rpc).toHaveBeenCalledWith("search_code", { snippet: "snip" });
  });

  it("no matches field is no matches", async () => {
    const { client } = clientAnswering(async () => ({}));

    expect(await client.searchCode("snip")).toEqual({ ok: true, matches: [] });
  });

  it("a failed search is a failure", async () => {
    const { client } = clientAnswering(async () => {
      throw new Error("rg missing");
    });

    expect(await client.searchCode("snip")).toEqual({ ok: false, reason: "rg missing" });
  });
});

describe("modelRegistry", () => {
  it("lists the models by name and marks the default", async () => {
    const { client } = clientAnswering(async () => ({
      registry: { zeta: {}, alpha: {} },
      default: "zeta",
    }));

    expect(await client.modelRegistry()).toEqual({
      ok: true,
      models: [
        { name: "alpha", current: false },
        { name: "zeta", current: true },
      ],
    });
  });

  it("an unavailable registry is a failure", async () => {
    const { client } = clientAnswering(async () => {
      throw new Error("offline");
    });

    expect((await client.modelRegistry()).ok).toBe(false);
  });
});

describe("modelRegistry without a registry", () => {
  it("is a failure, not an empty list", async () => {
    const { client } = clientAnswering(async () => ({ default: "x" }));

    expect((await client.modelRegistry()).ok).toBe(false);
  });
});

describe("searchCode rows", () => {
  it("drops a row without a path and keeps end_line when sent", async () => {
    const { client } = clientAnswering(async () => ({
      matches: [{ line: 3 }, { path: "b.py", line: 2, end_line: 4, preview: "y" }],
    }));

    expect(await client.searchCode("snip")).toEqual({
      ok: true,
      matches: [{ path: "b.py", line: 2, end_line: 4, preview: "y" }],
    });
  });
});

describe("the chat-side calls", () => {
  it("parses search_chat hits into camel-cased matches", async () => {
    const { client, rpc } = clientAnswering(async () => [
      {
        history_index: 4,
        role: "user",
        run_id: "r1",
        snippet: "…a bug…",
        match_start: 3,
        match_end: 6,
        created_at: 10,
      },
      "not a row",
    ]);

    const hits = await client.searchChat("s1", "bug", 5);

    expect(rpc).toHaveBeenCalledWith("search_chat", { session_id: "s1", query: "bug", limit: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ historyIndex: 4, runId: "r1", matchStart: 3, matchEnd: 6, createdAt: 10 });
  });

  it("reads a non-list search answer as no hits", async () => {
    const { client } = clientAnswering(async () => null);

    expect(await client.searchChat("s1", "q")).toEqual([]);
  });

  it("parses run_shell output and file completions", async () => {
    const shell = clientAnswering(async () => ({ output: "ok", exit_code: 2 }));
    expect(await shell.client.runShell("ls")).toMatchObject({ output: "ok", exitCode: 2 });

    const files = clientAnswering(async () => ({ matches: ["a.ts", 7], total: 9 }));
    expect(await files.client.completeFiles("a")).toMatchObject({ matches: ["a.ts"], total: 9 });
  });
});
