// @vitest-environment jsdom
/**
 * A sent message and the files it names.
 *
 * Contracts worth pinning:
 *   • An upload is drawn once, as the block under the message: its
 *     inline chip is gone from the sentence, so the file is not shown
 *     twice.
 *   • A file the person only mentions stays inline, as a chip in the
 *     sentence — it is a reference, not a file they sent.
 *   • The text the model sees is unchanged: the path stays in the
 *     message; only the drawing differs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { UserMessage } from "./UserMessage";
import { AttachmentContext } from "../../chat/attachmentContext";
import type { UserItem } from "../../chat/chatItem";
import { uploadRegistry } from "../../chat/uploadRegistry";
import type { IgniClient } from "../../protocol/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT = "/work/proj";
const UPLOAD = "/work/proj/.igni/attachments/s1/report.pdf";

function renderMessage(text: string) {
  const item: UserItem = { kind: "user", id: 1, text };
  return render(
    <AttachmentContext.Provider
      value={{ projectDir: PROJECT, client: { rpc: vi.fn() } as unknown as IgniClient }}
    >
      <UserMessage item={item} />
    </AttachmentContext.Provider>,
  );
}

describe("a message with an upload", () => {
  it("draws the file in the block under the message", () => {
    renderMessage(`here it is @${UPLOAD}`);
    expect(document.querySelector(".msg-attachments")).toBeTruthy();
    expect(document.querySelector(".msg-att-name")?.textContent).toBe("report.pdf");
  });

  it("does not draw the upload's chip in the sentence as well", () => {
    renderMessage(`here it is @${UPLOAD}`);
    expect(document.querySelector(".mention-chip")).toBeNull();
    expect(screen.queryByText("report.pdf")).toBeTruthy();
  });

  it("leaves the path in the message, which is what the model sees", () => {
    const item: UserItem = { kind: "user", id: 1, text: `here it is @${UPLOAD}` };
    render(
      <AttachmentContext.Provider
        value={{ projectDir: PROJECT, client: { rpc: vi.fn() } as unknown as IgniClient }}
      >
        <UserMessage item={item} />
      </AttachmentContext.Provider>,
    );
    expect(item.text).toContain(UPLOAD);
  });

  it("says the size the upload answered with", () => {
    uploadRegistry.remember(UPLOAD, { name: "report.pdf", size: 4096 });
    renderMessage(`here it is @${UPLOAD}`);
    expect(document.querySelector(".msg-att-size")?.textContent).toBe("4 KB");
  });
});

describe("a message with a mentioned file", () => {
  it("keeps the file inline, as a chip in the sentence", () => {
    renderMessage("look at @src/main.py");
    expect(document.querySelector(".mention-chip")).toBeTruthy();
    expect(screen.getByText("main.py")).toBeTruthy();
  });

  it("draws no block under it", () => {
    renderMessage("look at @src/main.py");
    expect(document.querySelector(".msg-attachments")).toBeNull();
  });
});

describe("a message with both", () => {
  it("draws the upload in the block and the reference in the sentence", () => {
    renderMessage(`look at @src/main.py and here is @${UPLOAD}`);
    expect(document.querySelectorAll(".mention-chip")).toHaveLength(1);
    expect(screen.getByText("main.py")).toBeTruthy();
    expect(document.querySelectorAll(".msg-att-row")).toHaveLength(1);
  });
});
