/**
 * The miniatures of the images a message carries.
 *
 * Contracts worth pinning:
 *   • The bytes are read once per path: scrolling back up the
 *     transcript does not read the file again.
 *   • A file that cannot be shown — too large, not an image, a read
 *     that failed — is remembered as such, and is not read again
 *     either.
 */

import { describe, expect, it, vi } from "vitest";

import { MAX_CACHED_THUMBNAILS, MAX_THUMBNAIL_BYTES, ThumbnailCache } from "./thumbnailCache";
import type { IgniClient } from "../protocol/client";

function fakeClient(rpc: (method: string, args?: Record<string, unknown>) => Promise<unknown>): IgniClient {
  return { rpc } as unknown as IgniClient;
}

const PIXEL = "iVBORw0KGgo=";

describe("the miniature of an image", () => {
  it("is a data URL of its bytes", async () => {
    const cache = new ThumbnailCache();
    const client = fakeClient(async () => ({
      path: "shot.png",
      data: PIXEL,
      size: 120,
      media_type: "image/png",
    }));
    const thumbnail = await cache.load("shot.png", client);
    expect(thumbnail.url).toBe(`data:image/png;base64,${PIXEL}`);
    expect(thumbnail.size).toBe(120);
  });

  it("reads the file once, however often it is asked for", async () => {
    const cache = new ThumbnailCache();
    const rpc = vi.fn(async () => ({
      path: "shot.png",
      data: PIXEL,
      size: 120,
      media_type: "image/png",
    }));
    const client = fakeClient(rpc);
    await cache.load("shot.png", client);
    await cache.load("shot.png", client);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("is kept once it has been read", async () => {
    const cache = new ThumbnailCache();
    const client = fakeClient(async () => ({
      path: "shot.png",
      data: PIXEL,
      size: 120,
      media_type: "image/png",
    }));
    await cache.load("shot.png", client);
    expect(cache.peek("shot.png")?.url).toBe(`data:image/png;base64,${PIXEL}`);
  });
});

describe("a file that cannot be shown", () => {
  it("has no miniature when the read failed", async () => {
    const cache = new ThumbnailCache();
    const client = fakeClient(async () => ({ path: "x", data: "", size: 0, error: "read failed" }));
    expect((await cache.load("x", client)).url).toBe("");
  });

  it("has no miniature when it is not an image", async () => {
    const cache = new ThumbnailCache();
    const client = fakeClient(async () => ({
      path: "x",
      data: PIXEL,
      size: 120,
      media_type: "application/pdf",
    }));
    expect((await cache.load("x", client)).url).toBe("");
  });

  it("has no miniature when it is too large", async () => {
    const cache = new ThumbnailCache();
    const client = fakeClient(async () => ({
      path: "x",
      data: PIXEL,
      size: MAX_THUMBNAIL_BYTES + 1,
      media_type: "image/png",
    }));
    expect((await cache.load("x", client)).url).toBe("");
  });

  it("has no miniature when the call threw", async () => {
    const cache = new ThumbnailCache();
    const client = fakeClient(async () => {
      throw new Error("the socket is gone");
    });
    expect((await cache.load("x", client)).url).toBe("");
  });

  it("is not read again once it has failed", async () => {
    const cache = new ThumbnailCache();
    const rpc = vi.fn(async () => ({ path: "x", data: "", size: 0, error: "read failed" }));
    const client = fakeClient(rpc);
    await cache.load("x", client);
    await cache.load("x", client);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("how many miniatures are kept", () => {
  it("drops the oldest when there are too many", async () => {
    const cache = new ThumbnailCache();
    const client = fakeClient(async (_method, args) => ({
      path: String(args?.path),
      data: PIXEL,
      size: 120,
      media_type: "image/png",
    }));
    for (let i = 0; i <= MAX_CACHED_THUMBNAILS; i++) {
      await cache.load(`shot-${i}.png`, client);
    }
    expect(cache.peek("shot-0.png")).toBeUndefined();
    expect(cache.peek(`shot-${MAX_CACHED_THUMBNAILS}.png`)?.url).toContain("data:image/png");
  });
});
