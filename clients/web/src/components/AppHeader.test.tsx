// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppHeader, type AppHeaderProps } from "./AppHeader";

afterEach(cleanup);

function header(props: Partial<AppHeaderProps> = {}) {
  const base: AppHeaderProps = {
    conn: "connected",
    groupName: "igni",
    groupMark: null,
    onToggleSidebar: () => {},
    sidebarOpen: true,
    canSearch: false,
    searchOpen: false,
    onToggleSearch: () => {},
    filesOpen: false,
    onToggleFiles: () => {},
    terminalOpen: false,
    onToggleTerminal: () => {},
    status: null,
    waiting: 0,
    onToggleNotifications: () => {},
    extensions: [],
    notificationCounts: { unread: 0, by_source: {} } as never,
    onOpenPage: () => {},
    client: { connect: () => {}, asExtension: () => ({}) as never } as never,
  };
  return <AppHeader {...base} {...props} />;
}

describe("AppHeader's terminal button", () => {
  it("sits right after the folder button and toggles the terminal", () => {
    const onToggleTerminal = vi.fn();
    render(header({ onToggleTerminal }));
    const files = screen.getByRole("button", { name: "Files" });
    const terminal = screen.getByRole("button", { name: "Terminal" });
    expect(files.nextElementSibling).toBe(terminal);
    expect(terminal.className).toBe("chip chip-terminal");
    expect(terminal.getAttribute("aria-pressed")).toBe("false");
    expect(terminal.title).toBe("Open terminal");
    fireEvent.click(terminal);
    expect(onToggleTerminal).toHaveBeenCalledTimes(1);
  });

  it("shows when the terminal is open", () => {
    render(header({ terminalOpen: true }));
    const terminal = screen.getByRole("button", { name: "Terminal" });
    expect(terminal.getAttribute("aria-pressed")).toBe("true");
    expect(terminal.className).toContain("active");
    expect(terminal.title).toBe("Close terminal");
  });
});

describe("AppHeader's right-hand icons", () => {
  it("put the bell first, then a divider, then the folder and terminal", () => {
    render(header({ waiting: 2 }));
    const bell = screen.getByRole("button", { name: "Notifications" });
    const divider = bell.nextElementSibling as HTMLElement;
    expect(divider.className).toBe("chip-divider");
    expect(divider.getAttribute("aria-hidden")).toBe("true");
    expect(divider.nextElementSibling).toBe(screen.getByRole("button", { name: "Files" }));
  });

  it("drop the divider with the bell when nothing is waiting", () => {
    const { container } = render(header());
    expect(screen.queryByRole("button", { name: "Notifications" })).toBeNull();
    expect(container.querySelector(".chip-divider")).toBeNull();
  });
});

describe("AppHeader's bell", () => {
  it("is lit and expanded while the notifications sheet is open", () => {
    const onToggleNotifications = vi.fn();
    const { rerender } = render(header({ waiting: 3, onToggleNotifications }));
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell.getAttribute("aria-expanded")).toBe("false");
    expect(bell.className).toBe("chip chip-bell has-waiting");
    expect(bell.querySelector(".chip-bell-count")?.textContent).toBe("3");
    fireEvent.click(bell);
    expect(onToggleNotifications).toHaveBeenCalledTimes(1);

    rerender(header({ waiting: 3, notificationsOpen: true }));
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    expect(bell.className).toBe("chip chip-bell has-waiting active");
  });
});
