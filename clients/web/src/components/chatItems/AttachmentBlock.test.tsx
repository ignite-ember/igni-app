// @vitest-environment jsdom
/**
 * The block under a sent message: the files it carries.
 *
 * Contracts worth pinning:
 *   • A document is a row — its glyph, the extension it is labelled by,
 *     its name and its size when the window knows it. Clicking a row
 *     opens the file in the read-only viewer.
 *   • An image is a miniature, read only once the message is near the
 *     viewport, and read once: the cache keeps what it read.
 *   • A file that cannot be shown as an image — too large, not an
 *     image, a read that failed — falls back to a row.
 *   • Only a few miniatures are drawn; the rest are rows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { AttachmentBlock, MAX_THUMBNAILS } from "./AttachmentBlock";
import { MessageAttachment } from "../../chat/messageAttachments";
import { ThumbnailCache } from "../../chat/thumbnailCache";
import type { IgniClient } from "../../protocol/client";
import { FileViewerContext } from "../pages/files/viewerContext";

/** The bytes of a one-pixel PNG, base64 — enough for an <img>. */
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function fakeClient(rpc: (method: string, args?: Record<string, unknown>) => Promise<unknown>): IgniClient {
  return { rpc } as unknown as IgniClient;
}

function imageClient(): { client: IgniClient; calls: string[] } {
  const calls: string[] = [];
  const client = fakeClient(async (method, args) => {
    calls.push(`${method}:${String(args?.path)}`);
    return { path: String(args?.path), data: PIXEL, size: 120, media_type: "image/png" };
  });
  return { client, calls };
}

function upload(path: string, name = path.split("/").pop() || path, size?: number): MessageAttachment {
  return new MessageAttachment(path, name, true, size);
}

/** The observer the viewport hook talks to, and the way to say an
 *  element has come into view. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly elements: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.elements.push(element);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** The element has come into view. */
  enter(): void {
    this.callback(
      this.elements.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    );
  }
}

beforeEach(() => {
  FakeObserver.instances = [];
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe("the block's rows", () => {
  it("draws the file's glyph, extension, name and size", () => {
    render(
      <FileViewerContext.Provider value={{ open: vi.fn() }}>
        <AttachmentBlock
          uploads={[upload("/p/.igni/attachments/s/report.pdf", "report.pdf", 2048)]}
          client={null}
        />
      </FileViewerContext.Provider>,
    );
    const row = document.querySelector(".msg-att-row") as HTMLElement;
    expect(row.querySelector(".msg-att-glyph svg")).toBeTruthy();
    expect(row.querySelector(".msg-att-label")?.textContent).toBe("PDF");
    expect(row.querySelector(".msg-att-name")?.textContent).toBe("report.pdf");
    expect(row.querySelector(".msg-att-size")?.textContent).toBe("2 KB");
  });

  it("says no size rather than guessing one", () => {
    render(
      <AttachmentBlock uploads={[upload("/p/.igni/attachments/s/report.pdf")]} client={null} />,
    );
    expect(document.querySelector(".msg-att-size")).toBeNull();
  });

  it("opens the file in the read-only viewer when clicked", () => {
    const open = vi.fn();
    render(
      <FileViewerContext.Provider value={{ open }}>
        <AttachmentBlock
          uploads={[upload("/p/.igni/attachments/s/report.pdf", "report.pdf")]}
          client={null}
        />
      </FileViewerContext.Provider>,
    );
    fireEvent.click(document.querySelector(".msg-att-row") as HTMLElement);
    expect(open).toHaveBeenCalledWith("/p/.igni/attachments/s/report.pdf");
  });
});

describe("the block's miniatures", () => {
  it("reads nothing until the message is near the viewport", () => {
    const { client, calls } = imageClient();
    render(
      <AttachmentBlock uploads={[upload("/p/.igni/attachments/s/shot.png", "shot.png")]} client={client} />,
    );
    expect(calls).toEqual([]);
    expect(document.querySelector(".msg-att-thumb")).toBeTruthy();
  });

  it("reads the bytes once the message comes near the viewport", async () => {
    const { client, calls } = imageClient();
    render(
      <AttachmentBlock uploads={[upload("/p/.igni/attachments/s/shot.png", "shot.png")]} client={client} />,
    );
    FakeObserver.instances[0].enter();
    await waitFor(() => expect(document.querySelector(".msg-att-thumb-img")).toBeTruthy());
    expect(calls).toEqual(["read_file_bytes:/p/.igni/attachments/s/shot.png"]);
  });

  it("reads the file once, however often the message is drawn", async () => {
    const { client, calls } = imageClient();
    const cache = new ThumbnailCache();
    const uploads = [upload("/p/.igni/attachments/s/shot.png", "shot.png")];
    const first = render(<AttachmentBlock uploads={uploads} client={client} cache={cache} />);
    FakeObserver.instances[0].enter();
    await waitFor(() => expect(document.querySelector(".msg-att-thumb-img")).toBeTruthy());
    first.unmount();
    cleanup();
    render(<AttachmentBlock uploads={uploads} client={client} cache={cache} />);
    FakeObserver.instances[1].enter();
    await waitFor(() => expect(document.querySelector(".msg-att-thumb-img")).toBeTruthy());
    expect(calls).toHaveLength(1);
  });

  it("falls back to a row when the read fails", async () => {
    const client = fakeClient(async () => ({ path: "x", data: "", size: 0, error: "read failed" }));
    render(
      <AttachmentBlock
        uploads={[upload("/p/.igni/attachments/s/shot.png", "shot.png")]}
        client={client}
        cache={new ThumbnailCache()}
      />,
    );
    FakeObserver.instances[0].enter();
    await waitFor(() => expect(document.querySelector(".msg-att-row")).toBeTruthy());
    expect(document.querySelector(".msg-att-thumb-img")).toBeNull();
    expect(document.querySelector(".msg-att-name")?.textContent).toBe("shot.png");
  });

  it("falls back to a row when the file is too large to be a miniature", async () => {
    const client = fakeClient(async () => ({
      path: "x",
      data: PIXEL,
      size: 9 * 1024 * 1024,
      media_type: "image/png",
    }));
    render(
      <AttachmentBlock
        uploads={[upload("/p/.igni/attachments/s/shot.png", "shot.png")]}
        client={client}
        cache={new ThumbnailCache()}
      />,
    );
    FakeObserver.instances[0].enter();
    await waitFor(() => expect(document.querySelector(".msg-att-row")).toBeTruthy());
  });

  it("falls back to a row when the file is not an image at all", async () => {
    const client = fakeClient(async () => ({
      path: "x",
      data: PIXEL,
      size: 120,
      media_type: "application/pdf",
    }));
    render(
      <AttachmentBlock
        uploads={[upload("/p/.igni/attachments/s/shot.png", "shot.png")]}
        client={client}
        cache={new ThumbnailCache()}
      />,
    );
    FakeObserver.instances[0].enter();
    await waitFor(() => expect(document.querySelector(".msg-att-row")).toBeTruthy());
  });
});

describe("the block's cap", () => {
  it("draws only a few miniatures, and the rest as rows", () => {
    const uploads = Array.from({ length: MAX_THUMBNAILS + 2 }, (_, i) =>
      upload(`/p/.igni/attachments/s/shot-${i}.png`, `shot-${i}.png`),
    );
    render(<AttachmentBlock uploads={uploads} client={null} />);
    expect(document.querySelectorAll(".msg-att-thumb")).toHaveLength(MAX_THUMBNAILS);
    expect(document.querySelectorAll(".msg-att-row")).toHaveLength(2);
  });
});
