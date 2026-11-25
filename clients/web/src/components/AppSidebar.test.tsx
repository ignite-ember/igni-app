// @vitest-environment jsdom
/**
 * ``AppSidebar`` lists the chats newest conversation first: each by the
 * later of its row's last message and the newest one the live states
 * told — so a chat moves up the moment a message goes in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.hoisted(() => {
  const data = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(i: number) {
      return Array.from(data.keys())[i] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: shim,
  });
  // jsdom doesn't ship ResizeObserver — the embedded
  // ScrollIndicator wires one. No-op stub is enough for our
  // tests (we don't depend on observed-size callbacks).
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: FakeResizeObserver,
  });
  (globalThis as unknown as { ResizeObserver: typeof FakeResizeObserver }).ResizeObserver =
    FakeResizeObserver;
});

import { AppSidebar } from "./AppSidebar";
import { SessionStates } from "../chat/sessionStates";

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () =>
      ({
        matches: false,
        media: "",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }) as unknown as MediaQueryList,
  });
});

function names(): string[] {
  return Array.from(document.querySelectorAll(".session-item .session-name")).map(
    (e) => e.textContent ?? "",
  );
}

function renderWith(states: SessionStates) {
  render(
    <AppSidebar
      sidebar={{ open: true, section: null } as never}
      layout={{ close: vi.fn(), setSection: vi.fn() } as never}
      sessions={[
        { session_id: "a", name: "Alpha", last_message_at: 3_000 },
        { session_id: "b", name: "Beta", last_message_at: 1_000 },
        { session_id: "c", name: "Gamma", last_message_at: 2_000 },
      ]}
      states={states}
      currentId=""
      contributions={{ sidebar: () => [], sidebarBadges: () => ({}) } as never}
      notificationCounts={{ unread: 0, by_source: {} }}
      activeKind={undefined}
      onOpenPage={vi.fn()}
      onNewChat={vi.fn()}
      onNewChatInFolder={vi.fn()}
      onPickSession={vi.fn()}
      status={null}
      client={{ rpc: vi.fn(async () => ({})) } as never}
      onLogIn={vi.fn()}
      onLogOut={vi.fn()}
    />,
  );
}

describe("AppSidebar's order", () => {
  it("lists the chats newest conversation first", () => {
    renderWith(SessionStates.NONE);

    expect(names()).toEqual(["Alpha", "Gamma", "Beta"]);
  });

  it("puts a chat on top the moment a message goes in, and marks it working", () => {
    const told = SessionStates.parse({
      sessions: [{ session_id: "b", state: "running", unread: false, last_message_at: 9_000 }],
    }) as SessionStates;

    renderWith(SessionStates.NONE.followedBy(told));

    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(document.querySelector(".session-item .session-running")?.closest(".session-item")?.textContent).toContain(
      "Beta",
    );
  });
});
