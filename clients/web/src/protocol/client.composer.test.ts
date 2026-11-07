// @vitest-environment jsdom
/**
 * The composer's RPCs on {@link IgniClient}: each expected failure comes
 * back as a Result, never as a rejection, and the happy path sends the
 * same wire call the backend has always received.
 */
import { describe, expect, it, vi } from "vitest";

import { IgniClient } from "./client";
import { MAX_ATTACHMENT_BYTES } from "./composerWire";

type Rpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** A client whose only seam is `rpc`. */
function clientAnswering(rpc: Rpc): { client: IgniClient; rpc: ReturnType<typeof vi.fn<Rpc>> } {
  const spy = vi.fn<Rpc>(rpc);
  const client = Object.assign(Object.create(IgniClient.prototype) as IgniClient, { rpc: spy });
  return { client, rpc: spy };
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
