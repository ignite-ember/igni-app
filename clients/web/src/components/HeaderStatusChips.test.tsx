// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ExtensionSummary } from "../extensions/ExtensionPage";
import { AppHeader } from "./AppHeader";
import { HeaderStatusChips, watchOverflow } from "./HeaderStatusChips";
import { StatusLine } from "./StatusLine";

afterEach(cleanup);

const running = (pid: number) => ({ pid, cmd: "sleep 600", elapsed_seconds: 1, is_running: true, exit_code: null });

function fakeClient(processes: unknown[], answers: Record<string, unknown> = {}) {
  return {
    connect: () => {},
    rpc: vi.fn(async () => processes),
    onEvent: () => () => {},
    asExtension: (id: string) => ({ rpc: async () => answers[id] ?? null }),
  } as never;
}

function extension(id: string, label: string): ExtensionSummary {
  return {
    id,
    name: id,
    version: "1",
    state: "READY",
    reason: "",
    origin: "user",
    allow: [],
    pages: [{ kind: `${id}-page`, label: `${label} page`, sidebar: true, entry: "index.html" }],
    menu: [],
    indicators: [{ id: `${id}-chip`, label, source: "status", opens: `${id}-page`, intervalSeconds: 60 }],
    settings: [],
    values: {},
  };
}

const status = {} as never;
const counts = { unread: 0, by_source: {} };

describe("the header's status chips", () => {
  it("render nothing before the status arrives", () => {
    const { container } = render(
      <HeaderStatusChips status={null} extensions={[extension("a", "A")]} notificationCounts={counts} onOpenPage={() => {}} client={fakeClient([running(1)])} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("put the watcher first, then extensions' chips in the order they came", async () => {
    const onOpenPage = vi.fn();
    const client = fakeClient([running(1), running(2)], {
      zeta: { label: "Zeta: ok", tone: "success", detail: "" },
      alpha: { label: "Alpha: 3", tone: "warning", detail: "" },
    });
    render(
      <HeaderStatusChips
        status={status}
        extensions={[extension("zeta", "Zeta"), extension("alpha", "Alpha")]}
        notificationCounts={counts}
        onOpenPage={onOpenPage}
        client={client}
      />,
    );
    const group = screen.getByRole("group", { name: "Status" });
    await waitFor(() => expect(group.querySelectorAll("button")).toHaveLength(3));
    const names = [...group.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual([
      "Watcher 2 background processes running",
      "Zeta: Zeta: ok. Open.",
      "Alpha: Alpha: 3. Open.",
    ]);

    fireEvent.click(screen.getByRole("button", { name: /^Watcher/ }));
    expect(onOpenPage).toHaveBeenLastCalledWith({ kind: "watcher", label: "Watcher" });
    fireEvent.click(screen.getByRole("button", { name: /^Alpha/ }));
    expect(onOpenPage).toHaveBeenLastCalledWith({ kind: "alpha-page", label: "Alpha page" });
  });

  it("show the watcher's count as a badge, styled like the header's quiet chips", async () => {
    render(<HeaderStatusChips status={status} extensions={[]} notificationCounts={counts} onOpenPage={() => {}} client={fakeClient([running(1)])} />);
    const chip = await screen.findByRole("button", { name: "Watcher 1 background process running" });
    expect(chip.className).toBe("chip chip-status chip-watcher");
    expect(chip.querySelector(".chip-status-count")?.textContent).toBe("1");
  });

  it("sit in the header right after the sidebar toggle and before the breadcrumb", async () => {
    render(
      <AppHeader
        conn="connected"
        groupName="igni"
        groupMark={null}
        onToggleSidebar={() => {}}
        sidebarOpen
        canSearch={false}
        searchOpen={false}
        onToggleSearch={() => {}}
        filesOpen={false}
        onToggleFiles={() => {}}
        terminalOpen={false}
        onToggleTerminal={() => {}}
        status={status}
        waiting={0}
        onToggleNotifications={() => {}}
        extensions={[]}
        notificationCounts={counts}
        onOpenPage={() => {}}
        client={fakeClient([running(1)])}
      />,
    );
    await screen.findByRole("button", { name: /^Watcher/ });
    const toggle = screen.getByRole("button", { name: "Hide sidebar" });
    const group = screen.getByRole("group", { name: "Status" });
    expect(toggle.nextElementSibling).toBe(group);
    expect(group.nextElementSibling?.id).toBe("app-header-crumbs");
  });
});

describe("the status row's overflow", () => {
  function row(clientWidth: number, scrollWidth: number) {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: clientWidth });
    Object.defineProperty(el, "scrollWidth", { value: scrollWidth });
    return el;
  }

  it("marks the edge that hides chips, and follows the scroll", () => {
    const el = row(100, 300);
    const stop = watchOverflow(el);
    expect(el.dataset.overflow).toBe("end");
    el.scrollLeft = 50;
    el.dispatchEvent(new Event("scroll"));
    expect(el.dataset.overflow).toBe("both");
    el.scrollLeft = 200;
    el.dispatchEvent(new Event("scroll"));
    expect(el.dataset.overflow).toBe("start");
    stop();
    el.scrollLeft = 0;
    el.dispatchEvent(new Event("scroll"));
    expect(el.dataset.overflow).toBe("start");
  });

  it("marks nothing when every chip fits", () => {
    const el = row(300, 300);
    el.dataset.overflow = "end";
    watchOverflow(el)();
    expect(el.dataset.overflow).toBeUndefined();
  });
});

describe("the footer", () => {
  it("keeps only the update waiting", () => {
    const onShowUpdate = vi.fn();
    const info = { latestVersion: "9.9.9" } as never;
    const { container } = render(<StatusLine pendingUpdate={info} onShowUpdate={onShowUpdate} />);
    expect(container.querySelectorAll("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Update to v9.9.9" }));
    expect(onShowUpdate).toHaveBeenCalledWith(info);
  });
});
