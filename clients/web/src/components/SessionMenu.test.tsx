// @vitest-environment jsdom
/**
 * The open chat's row has a right-click menu with "Compact conversation":
 * it runs the compact for the chat on screen, it is off while a reply is
 * running, and other chats' rows keep the browser's own menu.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Sidebar, type SessionEntry } from "./Sidebar";

beforeAll(() => {
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as never;
});

afterEach(cleanup);

const SESSIONS: SessionEntry[] = [
  { session_id: "open-chat", name: "Open chat" },
  { session_id: "other-chat", name: "Other chat" },
];

function renderSidebar({
  sessions = SESSIONS,
  busy,
  onCompact = vi.fn(),
}: { sessions?: SessionEntry[]; busy?: boolean; onCompact?: (() => void) | null } = {}) {
  render(
    <Sidebar
      open
      sessions={sessions}
      currentId="open-chat"
      links={[]}
      onLink={vi.fn()}
      onNewChat={vi.fn()}
      onPick={vi.fn()}
      onCompact={onCompact ?? undefined}
      busy={busy}
      onClose={vi.fn()}
      status={null}
      client={{ rpc: vi.fn(async () => ({})) } as never}
      onLogIn={vi.fn()}
      onLogOut={vi.fn()}
    />,
  );
  return { onCompact };
}

function row(name: string): HTMLElement {
  return screen.getByText(name).closest(".session-item") as HTMLElement;
}

function compactItem(): HTMLButtonElement | null {
  return screen.queryByRole("menuitem", { name: "Compact conversation" }) as HTMLButtonElement | null;
}

describe("the open chat's right-click menu", () => {
  it("offers Compact conversation and runs it", () => {
    const { onCompact } = renderSidebar();

    const opened = fireEvent.contextMenu(row("Open chat"), { clientX: 40, clientY: 60 });

    expect(opened).toBe(false);
    const item = compactItem();
    expect(item).not.toBeNull();
    expect(item!.disabled).toBe(false);
    fireEvent.click(item!);
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(compactItem()).toBeNull();
  });

  it("is off while a reply runs in the open chat", () => {
    const { onCompact } = renderSidebar({ busy: true });

    fireEvent.contextMenu(row("Open chat"));
    const item = compactItem()!;

    expect(item.disabled).toBe(true);
    fireEvent.click(item);
    expect(onCompact).not.toHaveBeenCalled();
  });

  it("is off while the backend says the open chat is working", () => {
    renderSidebar({
      sessions: [{ session_id: "open-chat", name: "Open chat", activity: "running" }],
    });

    fireEvent.contextMenu(row("Open chat"));

    expect(compactItem()!.disabled).toBe(true);
  });

  it("leaves another chat's row the browser's own menu", () => {
    renderSidebar();

    const opened = fireEvent.contextMenu(row("Other chat"));

    expect(opened).toBe(true);
    expect(compactItem()).toBeNull();
  });

  it("is not there when nothing can compact", () => {
    renderSidebar({ onCompact: null });

    const opened = fireEvent.contextMenu(row("Open chat"));

    expect(opened).toBe(true);
    expect(compactItem()).toBeNull();
  });

  it("closes on Escape and on a click elsewhere, without compacting", () => {
    const { onCompact } = renderSidebar();

    fireEvent.contextMenu(row("Open chat"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(compactItem()).toBeNull();

    fireEvent.contextMenu(row("Open chat"));
    fireEvent.mouseDown(document.body);
    expect(compactItem()).toBeNull();
    expect(onCompact).not.toHaveBeenCalled();
  });
});
