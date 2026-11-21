// @vitest-environment jsdom
/**
 * Two tabs of one browser are one window (F5, igni-app #96, CHAT-027):
 * what each tab's views do with the other tab's changes to the model.
 *
 * - The other tab moving to a session — a new chat, a pick — is
 *   followed: this tab binds that session too, so it gets the session's
 *   events. Before, it took the other tab's write for its own echo, kept
 *   its socket on the old session and dropped every event of the new one.
 * - The other tab scrolling is that tab's reading position: this tab
 *   stays put. An extension's `scroll_to` still moves it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { WindowModel, type WindowChange } from "../clientState";
import type { IgniClient } from "../protocol/client";
import type { SessionSwitcher, WindowOpening } from "./sessionSwitcher";
import { useSessionBinding } from "./useSessionBinding";
import { useTranscriptScroll } from "./useTranscriptScroll";

afterEach(cleanup);

/** One backend's window model, shared by the tabs it is handed to: it
 *  applies each write and broadcasts the change to every tab. */
function sharedModel() {
  let rev = 0;
  const tabs: WindowModel[] = [];
  const rpc = vi.fn(async (_method: string, args: Record<string, unknown> = {}) => {
    if (args.op === "hydrate") return { state: {}, rev, unset: [] };
    rev += 1;
    const change: WindowChange = {
      window: String(args.window),
      field: args.field as WindowChange["field"],
      value: args.value,
      rev,
      token: String(args.token ?? ""),
    };
    queueMicrotask(() => tabs.forEach((tab) => tab.applyPush(change)));
    return { rev };
  });
  const tab = () => {
    const model = new WindowModel({ rpc, clientId: `conn-${tabs.length}` } as unknown as IgniClient, "w-1");
    tabs.push(model);
    return model;
  };
  const extensionScrolls = (value: unknown) => {
    rev += 1;
    const change: WindowChange = { window: "w-1", field: "scroll", value, rev, token: "" };
    tabs.forEach((t) => t.applyPush(change));
  };
  return { tab, extensionScrolls };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("a tab follows the other tab of its window onto a session", () => {
  it("binds the session the other tab moved to", async () => {
    const shared = sharedModel();
    const older = shared.tab();
    const newer = shared.tab();
    const pick = vi.fn(async () => {});
    const client = {
      onStateChange: () => () => {},
      connect: () => {},
      close: () => {},
      sessionId: "s-old",
    };
    const opening: WindowOpening = { wantedDir: "", arrival: null };
    renderHook(() =>
      useSessionBinding({
        client: client as never,
        windowModel: older,
        sessions: { pick, bindOnConnect: vi.fn() } as unknown as SessionSwitcher,
        opening,
        onBound: async () => {},
      }),
    );

    await act(async () => {
      newer.write("session", "s-new");
      await flush();
    });

    expect(pick).toHaveBeenCalledWith("s-new");
    expect(older.get("session")).toBe("s-new");
  });
});

describe("a tab keeps its own place in the transcript", () => {
  function mount(model: WindowModel) {
    const hook = renderHook(() => useTranscriptScroll(model, []));
    const scrollToIndex = vi.fn();
    hook.result.current.virtuosoRef.current = { scrollToIndex } as never;
    return scrollToIndex;
  }

  it("does not jump where the other tab of its window scrolled", async () => {
    const shared = sharedModel();
    const older = shared.tab();
    const newer = shared.tab();
    const scrollToIndex = mount(older);
    scrollToIndex.mockClear();

    // The other tab's reader scrolls up, then back to the bottom.
    await act(async () => {
      newer.write("scroll", { message_id: null, at_bottom: false });
      await flush();
      newer.write("scroll", { message_id: null, at_bottom: true });
      await flush();
    });

    expect(older.get("scroll").at_bottom).toBe(true);
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("still goes where an extension's scroll_to says", async () => {
    const shared = sharedModel();
    const older = shared.tab();
    const scrollToIndex = mount(older);
    scrollToIndex.mockClear();

    act(() => shared.extensionScrolls({ message_id: null, at_bottom: true }));

    expect(scrollToIndex).toHaveBeenCalledWith({ index: "LAST", behavior: "auto" });
  });
});
