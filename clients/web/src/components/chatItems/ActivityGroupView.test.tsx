// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityDisclosure } from "../../chat/activityDisclosure";
import type { ActivityGroup } from "../../chat/activityGroups";
import { activitySteps } from "../../chat/activitySteps";
import type { ChatItem, ToolItem, ToolStatus } from "../../chat/chatItem";
import { FileViewerContext } from "../pages/files/viewerContext";
import {
  ActivityGroupView,
  formatElapsed,
  formatStepTime,
  MARKER_GAP,
  MARKER_SLOT,
  MORE_WIDTH,
  stepTooltip,
} from "./ActivityGroupView";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // The stub shadows jsdom's own, on Element.prototype.
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  vi.unstubAllGlobals();
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

/** Lays the marker strip out ``px`` wide; everything else stays unmeasured. */
function stripWidth(px: () => number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("activity-markers") ? px() : 0;
    },
  });
}

const head = () => document.querySelector<HTMLButtonElement>(".activity-head")!;
const markers = (root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(".activity-markers .step-marker")];
const markerButtons = () => [...document.querySelectorAll<HTMLButtonElement>(".step-marker-btn")];
const thoughtLines = () => [...document.querySelectorAll(".activity-thought-line .live-window-line")].map((l) => l.textContent);
const outputLines = () => [...document.querySelectorAll(".activity-output-line .live-window-line")].map((l) => l.textContent);
/** The mark a badge draws: a check, a cross or a dash, by its path. */
const markOf = (el: Element | null): string | null => {
  const d = el?.querySelector("svg path")?.getAttribute("d") ?? null;
  if (d === "M3 8.5l3.2 3.2L13 4.8") return "check";
  if (d === "M4 4l8 8M12 4l-8 8") return "cross";
  if (d === "M4 8h8") return "dash";
  return d;
};

describe("ActivityGroupView", () => {
  it("names the running step, the step count and the clock while running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const store = new ActivityDisclosure(null);
    const { container } = render(
      <ActivityGroupView
        group={group([thinking("hm"), tool("Bash", "npm test", "running")])}
        running
        startedAt={7_000}
        store={store}
      />,
    );
    expect(head().querySelector(".activity-tool-name")?.textContent).toBe("Bash");
    expect(head().querySelector(".activity-tool-args")?.textContent).toBe("npm test");
    expect(head().querySelector(".activity-meta")?.textContent).toBe("2 steps · 3s");
    expect(head().querySelector(".activity-status.state-live .activity-live-dot")).not.toBeNull();
    expect(head().querySelector(".activity-kind.glyph-command.live")).not.toBeNull();
    expect(container.querySelector(".step-marker.state-live")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(head().querySelector(".activity-meta")?.textContent).toBe("2 steps · 5s");
    // The step's own time runs beside it.
    expect(head().querySelector(".activity-step-tail")?.textContent).toBe("· 2s");
    // The cards stay behind the row.
    expect(screen.queryByText("npm test", { selector: ".tool-args" })).toBeNull();
  });

  it("says Thinking… with the thought icon while the last step is a thought", () => {
    render(<ActivityGroupView group={group([tool("Read", "a.ts"), thinking("t")])} running store={new ActivityDisclosure(null)} />);
    expect(head().textContent).toContain("Thinking…");
    expect(head().querySelector(".activity-kind.glyph-thinking.live")).not.toBeNull();
  });

  it("labels the step just done with a green check and its time, a failure with a cross and its exit code", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const store = new ActivityDisclosure(null);
    const bash = tool("Bash", "npm test", "running");
    const { rerender } = render(<ActivityGroupView group={group([bash])} running store={store} />);
    vi.setSystemTime(3_100);
    rerender(<ActivityGroupView group={group([{ ...bash, status: "done", result: "ok" }])} running store={store} />);
    expect(head().querySelector(".activity-status")?.className).toBe("activity-status state-done");
    expect(markOf(head().querySelector(".activity-status"))).toBe("check");
    expect(head().querySelector(".activity-step-tail")?.textContent).toBe("· 2s");

    const lint = tool("Bash", "npm run lint", "error", "Command exited with code 1:\neslint: 1 error");
    rerender(<ActivityGroupView group={group([{ ...bash, status: "done" }, lint])} running store={store} />);
    expect(head().querySelector(".activity-status")?.className).toBe("activity-status state-failed");
    expect(markOf(head().querySelector(".activity-status"))).toBe("cross");
    expect(head().querySelector(".activity-step-tail.state-failed")?.textContent).toBe("· exit 1");
    // No code in the output: it says it failed.
    rerender(<ActivityGroupView group={group([{ ...lint, result: "boom" }])} running store={store} />);
    expect(head().querySelector(".activity-step-tail")?.textContent).toBe("· failed");
    rerender(<ActivityGroupView group={group([tool("Bash", "rm -rf /", "rejected")])} running store={store} />);
    expect(head().querySelector(".activity-step-tail")?.textContent).toBe("· not run");
    expect(markOf(head().querySelector(".activity-status"))).toBe("dash");
  });

  it("sums up a finished group, with its time", () => {
    const { container } = render(
      <ActivityGroupView
        group={group([tool("Bash", "a"), tool("Bash", "b"), tool("Read", "x"), thinking("t")])}
        running={false}
        startedAt={1_000}
        endedAt={13_000}
        store={new ActivityDisclosure(null)}
      />,
    );
    // The sentence is the accessible label; the chips are what shows.
    expect(head().querySelector(".activity-label .sr-only")?.textContent).toBe("Ran 2 commands, read 1 file, thought");
    expect(head().querySelector(".activity-chips")?.getAttribute("aria-hidden")).toBe("true");
    expect(head().querySelector(".activity-meta")?.textContent).toBe("4 steps · 12s");
    expect(container.querySelector(".step-marker.state-live")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Ran 2 commands, read 1 file, thought");
  });

  it("marks and counts failed steps", () => {
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
    const h = head();
    expect(h.tagName).toBe("BUTTON");
    expect(h.getAttribute("type")).toBe("button");
    expect(h.getAttribute("aria-expanded")).toBe("false");
    const body = document.getElementById(h.getAttribute("aria-controls")!)!;
    expect(body.hidden).toBe(true);
    expect(container.querySelector(".tool-card")).toBeNull();

    fireEvent.click(h);
    expect(h.getAttribute("aria-expanded")).toBe("true");
    expect(body.hidden).toBe(false);
    expect(body.querySelectorAll(".tool-card")).toHaveLength(1);
    expect(body.querySelector(".thinking-toggle")).not.toBeNull();
    // A card inside still opens on its own.
    fireEvent.click(body.querySelector(".tool-card-header")!);
    expect(body.querySelector(".tool-card-body")?.textContent).toBe("ok");

    fireEvent.click(h);
    expect(h.getAttribute("aria-expanded")).toBe("false");
    expect(body.hidden).toBe(true);
  });

  it("toggles from the keyboard: Enter and Space on the native button", () => {
    const store = new ActivityDisclosure(null);
    render(<ActivityGroupView group={group([tool("Bash", "a")])} running={false} store={store} />);
    const h = head();
    h.focus();
    expect(document.activeElement).toBe(h);
    // jsdom does not synthesise a button's click from a key; the
    // browser does, which ``e2e/activity-groups.spec.ts`` pins.
    fireEvent.keyDown(h, { key: "Enter" });
    fireEvent.click(h);
    expect(h.getAttribute("aria-expanded")).toBe("true");
  });

  it("stays expanded across re-renders and streamed items", () => {
    const store = new ActivityDisclosure(null);
    const first = group([tool("Bash", "a", "running")]);
    const { rerender } = render(<ActivityGroupView group={first} running store={store} />);
    fireEvent.click(head());
    rerender(<ActivityGroupView group={group([...first.items, tool("Read", "b", "running")])} running store={store} />);
    expect(head().getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(head().getAttribute("aria-controls")!)!;
    expect(body.querySelectorAll(".tool-card")).toHaveLength(2);
  });

  it("stays expanded across an unmount and a reload of the page", () => {
    const storage = memoryStorage();
    const items = [tool("Bash", "a")];
    const before = new ActivityDisclosure(storage);
    const { unmount } = render(<ActivityGroupView group={group(items)} running={false} store={before} />);
    fireEvent.click(head());
    unmount();

    // A fresh store over the same storage is the page after a reload.
    const after = new ActivityDisclosure(storage);
    render(<ActivityGroupView group={group([tool("Bash", "a")])} running={false} store={after} />);
    expect(head().getAttribute("aria-expanded")).toBe("true");
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
    expect(head().getAttribute("aria-expanded")).toBe("true");
    expect(store.isOpen("run-1:0")).toBe(false);
  });
});

describe("the step markers", () => {
  it("draw one marker per step, in order, with its kind and how it went", () => {
    render(
      <ActivityGroupView
        group={group([
          thinking("first"),
          tool("Read", "a.ts"),
          tool("Edit", "a.ts"),
          tool("Bash", "npm run lint", "error"),
          tool("Grep", "x", "rejected"),
          tool("WebFetch", "https://x"),
          tool("mcp_github_list_issues", "repo"),
          tool("Agent", "helper"),
          tool("Todo", "t"),
          tool("Bash", "npm test", "running"),
        ])}
        running
        store={new ActivityDisclosure(null)}
      />,
    );
    expect(markers().map((d) => d.className)).toEqual([
      "step-marker glyph-thinking state-done",
      "step-marker glyph-read state-done",
      "step-marker glyph-edit state-done",
      "step-marker glyph-command state-failed",
      "step-marker glyph-search state-rejected",
      "step-marker glyph-fetch state-done",
      "step-marker glyph-mcp state-done",
      "step-marker glyph-agent state-done",
      "step-marker glyph-other state-done",
      "step-marker glyph-command state-live",
    ]);
    expect(screen.getByRole("toolbar", { name: "Steps" })).toBeTruthy();
  });

  it("carry their kind's icon, and how they went as a badge: a check, a cross, a dash, none while live", () => {
    render(
      <ActivityGroupView
        group={group([
          thinking("t"),
          tool("Read", "a"),
          tool("Bash", "x", "error"),
          tool("Bash", "y", "rejected"),
          tool("Bash", "z", "running"),
        ])}
        running
        store={new ActivityDisclosure(null)}
      />,
    );
    const [thought, read, failed, rejected, live] = markers();
    // Each kind's icon is its own drawing.
    const icon = (m: HTMLElement) => m.querySelector(":scope > svg")!.innerHTML;
    expect(new Set([icon(thought), icon(read), icon(failed)]).size).toBe(3);
    expect(icon(failed)).toBe(icon(live));
    expect(thought.querySelector(".step-badge")).toBeNull();
    expect(markOf(read.querySelector(".step-badge"))).toBe("check");
    expect(markOf(failed.querySelector(".step-badge"))).toBe("cross");
    expect(markOf(rejected.querySelector(".step-badge"))).toBe("dash");
    expect(live.querySelector(".step-badge")).toBeNull();
  });

  it("make a failure the one that stands out: its own state, the group's border, the red chip", () => {
    const { container } = render(
      <ActivityGroupView
        group={group([tool("Read", "a"), tool("Bash", "npm run lint", "error"), tool("Read", "b")])}
        running={false}
        store={new ActivityDisclosure(null)}
      />,
    );
    expect(markers().filter((m) => m.classList.contains("state-failed"))).toHaveLength(1);
    expect(container.querySelector(".activity-group")?.classList.contains("failed")).toBe(true);
  });

  it("rings a thought, and makes the last one live while the group runs on it", () => {
    const store = new ActivityDisclosure(null);
    const items = [tool("Read", "a.ts"), thinking("hm")];
    const { rerender } = render(<ActivityGroupView group={group(items)} running store={store} />);
    expect(markers()[1].className).toBe("step-marker glyph-thinking state-live");
    rerender(<ActivityGroupView group={group(items)} running={false} store={store} />);
    expect(markers()[1].className).toBe("step-marker glyph-thinking state-done");
  });

  it("names each step, its time and how it went in a tooltip on hover and on focus", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const store = new ActivityDisclosure(null);
    const running = tool("Bash", "npm test", "running");
    const first = group([thinking("plan"), running]);
    const { rerender } = render(<ActivityGroupView group={first} running startedAt={10_000} store={store} />);
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    const [thought, bash] = markerButtons();
    fireEvent.mouseEnter(bash);
    expect(screen.getByRole("tooltip").textContent).toBe("Bash npm test · 3s · running");
    expect(bash.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.mouseLeave(bash);
    expect(screen.queryByRole("tooltip")).toBeNull();

    // The step ends: its time stops, and the tooltip says how it went.
    vi.setSystemTime(14_000);
    rerender(
      <ActivityGroupView
        group={group([first.items[0], { ...running, status: "error", result: "Command exited with code 1:\nFAIL" }])}
        running
        startedAt={10_000}
        store={store}
      />,
    );
    vi.setSystemTime(30_000);
    fireEvent.focus(markerButtons()[1]);
    expect(screen.getByRole("tooltip").textContent).toBe("Bash npm test · 4s · failed · exit 1");
    expect(screen.getByRole("tooltip").className).toBe("step-tooltip state-failed");
    expect(markerButtons()[1].getAttribute("aria-label")).toBe("Bash npm test · 4s · failed · exit 1");
    // A thought seen only once it was over has no time to tell.
    fireEvent.focus(thought);
    expect(screen.getByRole("tooltip").textContent).toBe("Thought");
  });

  it("opens the group on a marker's click, and brings its step into view, lit for a moment", () => {
    vi.useFakeTimers();
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    const store = new ActivityDisclosure(null);
    render(
      <ActivityGroupView
        group={group([tool("Grep", "x", "done", "1"), tool("Read", "a.ts", "done", "2"), tool("Bash", "ls", "done", "3")])}
        running={false}
        store={store}
      />,
    );
    fireEvent.click(markerButtons()[1]);
    expect(head().getAttribute("aria-expanded")).toBe("true");
    expect(store.isOpen("run-1:0")).toBe(true);
    const step = document.querySelector('.activity-step[data-step-index="1"]')!;
    expect(scrolled).toEqual([step]);
    expect(step.classList.contains("flash")).toBe(true);
    expect(document.activeElement).toBe(step);
    act(() => {
      vi.advanceTimersByTime(1_700);
    });
    expect(step.classList.contains("flash")).toBe(false);
    // Picking from an open group keeps it open.
    fireEvent.click(markerButtons()[2]);
    expect(store.isOpen("run-1:0")).toBe(true);
    expect(scrolled[1]).toBe(document.querySelector('.activity-step[data-step-index="2"]'));
  });

  it("uses the row's width: every marker while they fit, +k only once the width runs out", () => {
    const items = Array.from({ length: 22 }, (_, i) => tool("Read", `f${i}.ts`));
    const all = 22 * MARKER_SLOT + 21 * MARKER_GAP;
    stripWidth(() => all);
    render(<ActivityGroupView group={group(items)} running={false} store={new ActivityDisclosure(null)} />);
    expect(markerButtons()).toHaveLength(22);
    expect(document.querySelector(".activity-more")).toBeNull();
    cleanup();

    // One pixel short: the earliest fold away, the "+k" keeps its room.
    stripWidth(() => all - 1);
    render(<ActivityGroupView group={group(items)} running={false} store={new ActivityDisclosure(null)} />);
    const fit = Math.floor((all - 1 - MORE_WIDTH + MARKER_GAP) / (MARKER_SLOT + MARKER_GAP));
    expect(markerButtons()).toHaveLength(fit);
    expect(document.querySelector(".activity-more")?.textContent).toBe(`+${22 - fit}`);
    expect(markerButtons()[0].getAttribute("aria-label")).toBe(`Read f${22 - fit}.ts · done`);
    expect(markerButtons().at(-1)!.getAttribute("aria-label")).toBe("Read f21.ts · done");
  });

  it("refits when the row is resized", () => {
    let width = 1000;
    let resize: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          resize = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    stripWidth(() => width);
    const items = Array.from({ length: 22 }, (_, i) => tool("Bash", `c${i}`));
    render(<ActivityGroupView group={group(items)} running={false} store={new ActivityDisclosure(null)} />);
    expect(markerButtons()).toHaveLength(22);
    width = 200;
    act(() => resize());
    expect(markerButtons()).toHaveLength(Math.floor((200 - MORE_WIDTH + MARKER_GAP) / (MARKER_SLOT + MARKER_GAP)));
  });

  it("opens the group at the last folded step from the +k", () => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    stripWidth(() => 120);
    const store = new ActivityDisclosure(null);
    render(
      <ActivityGroupView
        group={group(Array.from({ length: 10 }, (_, i) => tool("Read", `f${i}`)))}
        running={false}
        store={store}
      />,
    );
    const more = document.querySelector<HTMLButtonElement>(".activity-more")!;
    const hidden = Number(more.textContent!.slice(1));
    expect(more.getAttribute("aria-label")).toBe(`${hidden} earlier steps`);
    fireEvent.click(more);
    expect(store.isOpen("run-1:0")).toBe(true);
    expect(document.querySelector(".activity-step.flash")?.getAttribute("data-step-index")).toBe(String(hidden - 1));
  });

  it("is one tab stop, walked with the arrow keys", () => {
    render(
      <ActivityGroupView
        group={group([tool("Read", "a"), tool("Read", "b"), tool("Read", "c")])}
        running={false}
        store={new ActivityDisclosure(null)}
      />,
    );
    const btns = markerButtons();
    expect(btns.map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
    btns[2].focus();
    fireEvent.keyDown(btns[2], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(btns[1]);
    fireEvent.keyDown(btns[1], { key: "Home" });
    expect(document.activeElement).toBe(btns[0]);
    fireEvent.keyDown(btns[0], { key: "End" });
    expect(document.activeElement).toBe(btns[2]);
    fireEvent.keyDown(btns[2], { key: "ArrowRight" });
    expect(document.activeElement).toBe(btns[2]);
  });
});

describe("the thinking under the markers", () => {
  it("shows only the last four lines of a streaming thought, and follows it", () => {
    const store = new ActivityDisclosure(null);
    const t = { kind: "thinking", id: nextId++, text: "zero\none\ntwo\nthree\nfour" } as const;
    const { rerender } = render(<ActivityGroupView group={group([t])} running store={store} />);
    expect(thoughtLines()).toEqual(["one", "two", "three", "four"]);
    expect(document.querySelector(".activity-thought-line")?.classList.contains("live")).toBe(true);
    expect(document.querySelector(".activity-live")?.getAttribute("aria-hidden")).toBe("true");
    // Under the markers, inside the group.
    const markersEl = document.querySelector(".activity-markers")!;
    const feed = document.querySelector(".activity-feed")!;
    expect(markersEl.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(feed.querySelector(".live-window")?.classList.contains("mono")).toBe(false);
    rerender(<ActivityGroupView group={group([{ ...t, text: `${t.text}\nfive and` }])} running store={store} />);
    expect(thoughtLines()).toEqual(["two", "three", "four", "five and"]);
    rerender(<ActivityGroupView group={group([{ ...t, text: `${t.text}\nfive and six` }])} running store={store} />);
    expect(thoughtLines()).toEqual(["two", "three", "four", "five and six"]);
  });

  it("reads a long thought from its end only", () => {
    const long = `${"word ".repeat(400)}the end`;
    render(<ActivityGroupView group={group([thinking(long)])} running store={new ActivityDisclosure(null)} />);
    const [line] = thoughtLines();
    expect(line!.endsWith("the end")).toBe(true);
    expect(line!.length).toBeLessThanOrEqual(360);
    expect(line!.startsWith("word ")).toBe(true);
  });

  it("keeps the latest thought in view after its step ends and the next ones run", () => {
    const store = new ActivityDisclosure(null);
    const t = thinking("check the tokens first\nthen run the tests");
    const { rerender } = render(<ActivityGroupView group={group([t])} running store={store} />);
    const bash = tool("Bash", "npm test", "running");
    rerender(<ActivityGroupView group={group([t, bash])} running store={store} />);
    expect(thoughtLines()).toEqual(["check the tokens first", "then run the tests"]);
    expect(document.querySelector(".activity-thought-line")?.classList.contains("live")).toBe(false);
    // A newer thought takes its place.
    rerender(<ActivityGroupView group={group([t, { ...bash, status: "done" }, thinking("all green")])} running store={store} />);
    expect(thoughtLines()).toEqual(["all green"]);
    expect(document.querySelector(".activity-thought-line")?.classList.contains("live")).toBe(true);
  });

  it("keeps the last thought in three lines once done, opening to all of the thinking and back", () => {
    const store = new ActivityDisclosure(null);
    render(
      <ActivityGroupView
        group={group([thinking("first idea"), tool("Read", "a"), thinking("1\n2\n3\n4\n5")])}
        running={false}
        store={store}
      />,
    );
    expect(thoughtLines()).toEqual(["3", "4", "5"]);
    const toggle = screen.getByRole("button", { name: "All thinking" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Less");
    expect([...document.querySelectorAll(".activity-thoughts-full p")].map((p) => p.textContent)).toEqual([
      "first idea",
      "1\n2\n3\n4\n5",
    ]);
    // The group itself stays collapsed.
    expect(head().getAttribute("aria-expanded")).toBe("false");
    expect(store.isOpen("run-1:0:thinking")).toBe(true);
    fireEvent.click(toggle);
    expect(document.querySelector(".activity-thoughts-full")).toBeNull();
    expect(thoughtLines()).toEqual(["3", "4", "5"]);
  });

  it("keeps all of the thinking open across an unmount", () => {
    const store = new ActivityDisclosure(null);
    const items = [thinking("a"), thinking("b")];
    const { unmount } = render(<ActivityGroupView group={group(items)} running={false} store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "All thinking" }));
    unmount();
    render(<ActivityGroupView group={group(items)} running={false} store={store} />);
    expect(document.querySelectorAll(".activity-thoughts-full p")).toHaveLength(2);
  });

  it("has no thinking area, nor toggle, for a group that never thought", () => {
    render(<ActivityGroupView group={group([tool("Read", "a")])} running={false} store={new ActivityDisclosure(null)} />);
    expect(document.querySelector(".activity-feed")).toBeNull();
    expect(screen.queryByRole("button", { name: "All thinking" })).toBeNull();
  });

  it("gives way to the timeline when the group is open", () => {
    const store = new ActivityDisclosure(null);
    render(<ActivityGroupView group={group([thinking("a\nb")])} running store={store} />);
    fireEvent.click(head());
    expect(document.querySelector(".activity-feed")).toBeNull();
    expect(document.querySelector(".activity-thought-preview")).not.toBeNull();
  });
});

describe("the command's output tail", () => {
  it("shows the last two lines of a running command's output, in mono, apart from the thought", () => {
    render(
      <ActivityGroupView
        group={group([thinking("run them"), tool("Bash", "npm test", "running", "a\nb\nc\n")])}
        running
        store={new ActivityDisclosure(null)}
      />,
    );
    expect(outputLines()).toEqual(["b", "c"]);
    expect(thoughtLines()).toEqual(["run them"]);
    expect(document.querySelector(".activity-output-line .live-window")?.classList.contains("mono")).toBe(true);
    expect(document.querySelector(".activity-output-line .activity-output-icon")).not.toBeNull();
  });

  it("is not drawn for a command with no output yet, and goes when it ends", () => {
    const store = new ActivityDisclosure(null);
    const bash = tool("Bash", "npm test", "running");
    const { rerender } = render(<ActivityGroupView group={group([bash])} running store={store} />);
    expect(document.querySelector(".activity-output-line")).toBeNull();
    rerender(<ActivityGroupView group={group([{ ...bash, result: "  \n" }])} running store={store} />);
    expect(document.querySelector(".activity-output-line")).toBeNull();
    rerender(<ActivityGroupView group={group([{ ...bash, result: "PASS a.test" }])} running store={store} />);
    expect(outputLines()).toEqual(["PASS a.test"]);
    rerender(<ActivityGroupView group={group([{ ...bash, status: "done", result: "PASS a.test" }])} running store={store} />);
    expect(document.querySelector(".activity-output-line")).toBeNull();
    // Nor once the turn stops on it.
    rerender(<ActivityGroupView group={group([{ ...bash, result: "PASS a.test" }])} running={false} store={store} />);
    expect(document.querySelector(".activity-output-line")).toBeNull();
  });
});

describe("the finished summary", () => {
  it("has a coloured chip per kind of step, the failures in red after the commands that went through", () => {
    render(
      <ActivityGroupView
        group={group([
          tool("Bash", "a"),
          tool("Bash", "b", "error"),
          tool("Bash", "c"),
          tool("Bash", "d"),
          tool("Read", "x"),
          tool("Read", "y"),
          tool("Edit", "x"),
          tool("Grep", "q"),
          tool("WebFetch", "u"),
          tool("mcp_github_get", "g"),
          tool("Agent", "z"),
          tool("Todo", "t"),
          thinking("t1"),
          thinking("t2"),
        ])}
        running={false}
        store={new ActivityDisclosure(null)}
      />,
    );
    const chips = [...document.querySelectorAll(".activity-chips .activity-chip")].map((c) => [
      c.className.replace("activity-chip ", ""),
      c.textContent,
    ]);
    expect(chips).toEqual([
      ["chip-command", "3commands"],
      ["activity-failed", "1 failed"],
      ["chip-read", "2files read"],
      ["chip-edit", "1edited"],
      ["chip-search", "1search"],
      ["chip-fetch", "1page"],
      ["chip-mcp", "1MCP tool"],
      ["chip-agent", "1agent"],
      ["chip-other", "1tool"],
      ["chip-thinking", "2thoughts"],
    ]);
    // The commands that went through carry a check; the failures a cross.
    expect(markOf(document.querySelector(".chip-command .activity-chip-ok"))).toBe("check");
    expect(markOf(document.querySelector(".activity-failed"))).toBe("cross");
    // Each chip has its kind's icon.
    expect(document.querySelectorAll(".activity-chips .activity-chip > svg")).toHaveLength(10);
  });

  it("puts the failures first when no command went through", () => {
    render(
      <ActivityGroupView
        group={group([tool("Read", "x"), tool("Bash", "b", "error")])}
        running={false}
        store={new ActivityDisclosure(null)}
      />,
    );
    expect([...document.querySelectorAll(".activity-chips .activity-chip")].map((c) => c.textContent)).toEqual([
      "1 failed",
      "1file read",
    ]);
  });

  it("leaves out the kinds it has none of, and the failure chip with no failures", () => {
    render(<ActivityGroupView group={group([tool("Read", "x")])} running={false} store={new ActivityDisclosure(null)} />);
    expect([...document.querySelectorAll(".activity-chips .activity-chip")].map((c) => c.textContent)).toEqual(["1file read"]);
    expect(document.querySelector(".activity-failed")).toBeNull();
  });

  it("lists the edited files once each, opening one in the file viewer", () => {
    const open = vi.fn();
    render(
      <FileViewerContext.Provider value={{ open }}>
        <ActivityGroupView
          group={group([
            tool("Edit", "src/components/Button.tsx"),
            tool("Write", "src/theme.css"),
            tool("Edit", "src/components/Button.tsx"),
            tool("Edit", "src/broken.ts", "error"),
            tool("Read", "src/other.ts"),
          ])}
          running={false}
          store={new ActivityDisclosure(null)}
        />
      </FileViewerContext.Provider>,
    );
    const chips = screen.getAllByRole("button", { name: /^Open / });
    expect(chips.map((c) => c.textContent)).toEqual(["Button.tsx", "theme.css"]);
    fireEvent.click(chips[0]);
    expect(open).toHaveBeenCalledWith("src/components/Button.tsx");
  });

  it("shows the edited files as plain chips where there is no viewer, and none while running", () => {
    const { rerender } = render(
      <ActivityGroupView group={group([tool("Edit", "a/b.ts")])} running={false} store={new ActivityDisclosure(null)} />,
    );
    expect(document.querySelector("span.activity-file-chip")?.textContent).toBe("b.ts");
    expect(document.querySelector("button.activity-file-chip")).toBeNull();
    rerender(<ActivityGroupView group={group([tool("Edit", "a/b.ts")])} running store={new ActivityDisclosure(null)} />);
    expect(document.querySelector(".activity-file-chip")).toBeNull();
  });
});

describe("the timeline", () => {
  it("puts each step on the line beside its marker, with its time at the right", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const store = new ActivityDisclosure(null);
    store.set("run-1:0", true);
    const read = tool("Read", "a.ts", "running");
    const { rerender } = render(<ActivityGroupView group={group([read])} running startedAt={1_000} store={store} />);
    expect(document.querySelector(".activity-step .step-marker.state-live")).not.toBeNull();
    vi.setSystemTime(3_000);
    const done = { ...read, status: "done" as const };
    rerender(<ActivityGroupView group={group([done, thinking("next\nsteps")])} running startedAt={1_000} store={store} />);
    const steps = [...document.querySelectorAll(".activity-timeline > .activity-step")];
    expect(steps.map((s) => s.querySelector(".activity-rail .step-marker")?.className)).toEqual([
      "step-marker glyph-read state-done",
      "step-marker glyph-thinking state-live",
    ]);
    expect(markOf(steps[0].querySelector(".activity-rail .step-badge"))).toBe("check");
    expect(steps[0].querySelector(".tool-card")).not.toBeNull();
    expect(steps[0].querySelector(".activity-step-time")?.textContent).toBe("2s");
    // The live thought's clock runs with the group's.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(steps[1].querySelector(".activity-step-time")?.textContent).toBe("2s");
  });

  it("marks a failed step on the rail with a cross, and its exit code by its time", () => {
    const store = new ActivityDisclosure(null);
    store.set("run-1:0", true);
    render(
      <ActivityGroupView
        group={group([tool("Bash", "npm run lint", "error", "Command exited with code 2:\nx"), tool("Bash", "ls", "error", "boom")])}
        running={false}
        store={store}
      />,
    );
    const [coded, plain] = [...document.querySelectorAll(".activity-timeline > .activity-step")];
    expect(coded.classList.contains("state-failed")).toBe(true);
    expect(markOf(coded.querySelector(".activity-rail .step-badge"))).toBe("cross");
    expect(coded.querySelector(".activity-step-exit")?.textContent).toBe("exit 2");
    expect(plain.querySelector(".activity-step-exit")).toBeNull();
  });

  it("keeps the thoughts inline, in order: their last lines until opened, all of it then", () => {
    const store = new ActivityDisclosure(null);
    store.set("run-1:0", true);
    render(<ActivityGroupView group={group([tool("Read", "a"), thinking("1\n2\n3\n4\n5\n6"), tool("Read", "b")])} running={false} store={store} />);
    const kinds = [...document.querySelectorAll(".activity-timeline > .activity-step")].map((s) => s.className.split(" ")[1]);
    expect(kinds).toEqual(["glyph-read", "glyph-thinking", "glyph-read"]);
    const toggle = screen.getByRole("button", { name: /Thought/, expanded: false });
    const preview = [...document.querySelectorAll(".activity-thought-preview .live-window-line")].map((l) => l.textContent);
    expect(preview).toEqual(["3", "4", "5", "6"]);
    fireEvent.click(toggle);
    expect(document.querySelector(".activity-thought-preview")).toBeNull();
    expect(document.querySelector(".activity-thought .msg-thinking")?.textContent).toBe("1\n2\n3\n4\n5\n6");
  });
});

describe("stepTooltip", () => {
  it("leaves out what it does not know", () => {
    const [read] = activitySteps([tool("Read", "a")], false);
    expect(stepTooltip(read, null)).toBe("Read a · done");
    expect(stepTooltip({ ...read, state: "rejected" }, "1s")).toBe("Read a · 1s · not run");
    const [thought] = activitySteps([thinking("t")], false);
    expect(stepTooltip(thought, "2s")).toBe("Thought · 2s");
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

describe("formatStepTime", () => {
  it("says a quick step took under a second", () => {
    expect([0, 999, 1_000, 61_000].map(formatStepTime)).toEqual(["<1s", "<1s", "1s", "1m 1s"]);
  });
});

describe("formatElapsed", () => {
  it("reads as seconds, then minutes", () => {
    expect([0, 12_400, 59_000, 60_000, 125_000].map(formatElapsed)).toEqual(["0s", "12s", "59s", "1m", "2m 5s"]);
  });
});
