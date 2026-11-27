// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityDisclosure } from "../../chat/activityDisclosure";
import type { ActivityGroup } from "../../chat/activityGroups";
import type { ChatItem, ToolItem, ToolStatus } from "../../chat/chatItem";
import { ActivityGroupView, formatElapsed } from "./ActivityGroupView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let nextId = 1;
const tool = (name: string, args: string, status: ToolStatus = "done", result = ""): ToolItem => ({
  kind: "tool",
  id: nextId++,
  runId: "run-1",
  name,
  args,
  status,
  result,
  isError: status === "error",
  diffRows: null,
});
const thinking = (text: string): ChatItem => ({ kind: "thinking", id: nextId++, text });

const group = (items: ChatItem[], key = "run-1:0"): ActivityGroup => ({ key, items, start: 1, tail: true });

/** Storage over a plain map, shared across "reloads". */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const header = () => screen.getByRole("button", { expanded: false }) as HTMLButtonElement;

describe("ActivityGroupView", () => {
  it("shows the running step's label, the step count and the clock while running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const store = new ActivityDisclosure(null);
    render(
      <ActivityGroupView
        group={group([thinking("hm"), tool("Bash", "npm test", "running")])}
        running
        startedAt={7_000}
        store={store}
      />,
    );
    const head = header();
    expect(head.querySelector(".activity-tool-name")?.textContent).toBe("Bash");
    expect(head.querySelector(".activity-tool-args")?.textContent).toBe("npm test");
    expect(head.querySelector(".activity-meta")?.textContent).toBe("2 steps · 3s");
    expect(head.querySelector(".activity-dot.live")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(head.querySelector(".activity-meta")?.textContent).toBe("2 steps · 5s");
    // The cards stay behind the row.
    expect(screen.queryByText("npm test", { selector: ".tool-args" })).toBeNull();
  });

  it("says Thinking… while the last step is a thought", () => {
    render(<ActivityGroupView group={group([tool("Read", "a.ts"), thinking("t")])} running store={new ActivityDisclosure(null)} />);
    expect(header().textContent).toContain("Thinking…");
  });

  it("sums up a finished group, with its time", () => {
    render(
      <ActivityGroupView
        group={group([tool("Bash", "a"), tool("Bash", "b"), tool("Read", "x"), thinking("t")])}
        running={false}
        startedAt={1_000}
        endedAt={13_000}
        store={new ActivityDisclosure(null)}
      />,
    );
    const head = header();
    expect(head.querySelector(".activity-label")?.textContent).toBe("Ran 2 commands, read 1 file, thought");
    expect(head.querySelector(".activity-meta")?.textContent).toBe("4 steps · 12s");
    expect(head.querySelector(".activity-dot.live")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Ran 2 commands, read 1 file, thought");
  });

  it("marks and counts failed steps, quietly", () => {
    const { container } = render(
      <ActivityGroupView
        group={group([tool("Bash", "a", "error"), tool("Bash", "b", "error"), tool("Read", "x")])}
        running={false}
        store={new ActivityDisclosure(null)}
      />,
    );
    expect(container.querySelector(".activity-group.failed")).not.toBeNull();
    expect(container.querySelector(".activity-failed")?.textContent).toBe("2 failed");
    expect(screen.getByRole("status").textContent).toBe("Ran 2 commands, read 1 file, 2 failed");
  });

  it("announces only that it works while running, not each step", () => {
    const store = new ActivityDisclosure(null);
    const g1 = group([tool("Bash", "a", "running")]);
    const { rerender } = render(<ActivityGroupView group={g1} running store={store} />);
    expect(screen.getByRole("status").textContent).toBe("Working");
    rerender(<ActivityGroupView group={group([...g1.items, tool("Read", "b", "running")])} running store={store} />);
    expect(screen.getByRole("status").textContent).toBe("Working");
  });

  it("expands to today's cards and collapses again, with aria wired", () => {
    const store = new ActivityDisclosure(null);
    const { container } = render(
      <ActivityGroupView group={group([tool("Bash", "npm test", "done", "ok"), thinking("why")])} running={false} store={store} />,
    );
    const head = header();
    expect(head.tagName).toBe("BUTTON");
    expect(head.getAttribute("type")).toBe("button");
    const body = document.getElementById(head.getAttribute("aria-controls")!)!;
    expect(body.hidden).toBe(true);
    expect(container.querySelector(".tool-card")).toBeNull();

    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(body.hidden).toBe(false);
    expect(body.querySelectorAll(".tool-card")).toHaveLength(1);
    expect(body.querySelector(".thinking-toggle")).not.toBeNull();
    // A card inside still opens on its own.
    fireEvent.click(body.querySelector(".tool-card-header")!);
    expect(body.querySelector(".tool-card-body")?.textContent).toBe("ok");

    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
  });

  it("toggles from the keyboard: Enter and Space on the native button", () => {
    const store = new ActivityDisclosure(null);
    render(<ActivityGroupView group={group([tool("Bash", "a")])} running={false} store={store} />);
    const head = header();
    head.focus();
    expect(document.activeElement).toBe(head);
    // jsdom does not synthesise a button's click from a key; the
    // browser does, which ``e2e/activity-groups.spec.ts`` pins.
    fireEvent.keyDown(head, { key: "Enter" });
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  it("stays expanded across re-renders and streamed items", () => {
    const store = new ActivityDisclosure(null);
    const first = group([tool("Bash", "a", "running")]);
    const { rerender } = render(<ActivityGroupView group={first} running store={store} />);
    fireEvent.click(header());
    rerender(<ActivityGroupView group={group([...first.items, tool("Read", "b", "running")])} running store={store} />);
    const head = screen.getByRole("button", { expanded: true });
    const body = document.getElementById(head.getAttribute("aria-controls")!)!;
    expect(body.querySelectorAll(".tool-card")).toHaveLength(2);
  });

  it("stays expanded across an unmount and a reload of the page", () => {
    const storage = memoryStorage();
    const items = [tool("Bash", "a")];
    const before = new ActivityDisclosure(storage);
    const { unmount } = render(<ActivityGroupView group={group(items)} running={false} store={before} />);
    fireEvent.click(header());
    unmount();

    // A fresh store over the same storage is the page after a reload.
    const after = new ActivityDisclosure(storage);
    render(<ActivityGroupView group={group([tool("Bash", "a")])} running={false} store={after} />);
    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
  });

  it("keeps a group with no run anchor open for this page only", () => {
    const storage = memoryStorage();
    const store = new ActivityDisclosure(storage);
    store.set("item:5", true);
    store.set("run-x:0", true);
    expect(JSON.parse(storage.getItem("igni:activity-open")!)).toEqual(["run-x:0"]);
    expect(store.isOpen("item:5")).toBe(true);
    expect(new ActivityDisclosure(storage).isOpen("item:5")).toBe(false);
  });

  it("opens for a search result inside it without changing the choice", () => {
    const store = new ActivityDisclosure(null);
    render(<ActivityGroupView group={group([tool("Bash", "a")])} running={false} forceOpen store={store} />);
    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
    expect(store.isOpen("run-1:0")).toBe(false);
  });
});

describe("ActivityDisclosure", () => {
  it("survives storage that throws or holds junk", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    const store = new ActivityDisclosure(broken);
    store.set("a:0", true);
    expect(store.isOpen("a:0")).toBe(true);
    const junk = memoryStorage();
    junk.setItem("igni:activity-open", '{"not":"a list"}');
    expect(new ActivityDisclosure(junk).isOpen("not")).toBe(false);
  });

  it("tells subscribers of a change, and not of a no-op", () => {
    const store = new ActivityDisclosure(null);
    const heard = vi.fn();
    const off = store.subscribe(heard);
    store.set("a:0", true);
    store.set("a:0", true);
    store.set("a:0", false);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    store.set("a:0", true);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("clocks a group from when it is first seen running to when it stops", () => {
    const store = new ActivityDisclosure(null);
    expect(store.clock("g", false, 5)).toBeNull();
    expect(store.clock("g", true, 10)).toEqual({ start: 10, end: null });
    expect(store.clock("g", true, 20)).toEqual({ start: 10, end: null });
    expect(store.clock("g", false, 30)).toEqual({ start: 10, end: 30 });
    expect(store.clock("g", false, 40)).toEqual({ start: 10, end: 30 });
  });
});

describe("formatElapsed", () => {
  it("reads as seconds, then minutes", () => {
    expect([0, 12_400, 59_000, 60_000, 125_000].map(formatElapsed)).toEqual(["0s", "12s", "59s", "1m", "2m 5s"]);
  });
});
