// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityDisclosure } from "../../chat/activityDisclosure";
import type { ActivityGroup } from "../../chat/activityGroups";
import type { ChatItem, ToolItem, ToolStatus } from "../../chat/chatItem";
import { FileViewerContext } from "../pages/files/viewerContext";
import { ActivityGroupView, formatElapsed, formatStepTime, STRIP_MAX, stepTooltip } from "./ActivityGroupView";

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
    const { container } = render(
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
    expect(container.querySelector(".step-dot.state-live")).not.toBeNull();
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
    const { container } = render(
      <ActivityGroupView
        group={group([tool("Bash", "a"), tool("Bash", "b"), tool("Read", "x"), thinking("t")])}
        running={false}
        startedAt={1_000}
        endedAt={13_000}
        store={new ActivityDisclosure(null)}
      />,
    );
    const head = header();
    // The sentence is the accessible label; the chips are what shows.
    expect(head.querySelector(".activity-label .sr-only")?.textContent).toBe("Ran 2 commands, read 1 file, thought");
    expect(head.querySelector(".activity-chips")?.getAttribute("aria-hidden")).toBe("true");
    expect(head.querySelector(".activity-meta")?.textContent).toBe("4 steps · 12s");
    expect(container.querySelector(".step-dot.state-live")).toBeNull();
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

const dots = (root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(".activity-dots .step-dot")];
const dotButtons = () => [...document.querySelectorAll<HTMLButtonElement>(".step-dot-btn")];
const windowLines = (root: ParentNode = document) =>
  [...root.querySelectorAll(".activity-live .live-window-line")].map((l) => l.textContent);

describe("the step dots", () => {
  it("draw one dot per step, in order, with its kind and how it went", () => {
    render(
      <ActivityGroupView
        group={group([
          thinking("first"),
          tool("Read", "a.ts"),
          tool("Edit", "a.ts"),
          tool("Bash", "npm run lint", "error"),
          tool("Grep", "x", "rejected"),
          tool("WebFetch", "https://x"),
          tool("Bash", "npm test", "running"),
        ])}
        running
        store={new ActivityDisclosure(null)}
      />,
    );
    expect(dots().map((d) => d.className)).toEqual([
      "step-dot glyph-thinking state-done",
      "step-dot glyph-read state-done",
      "step-dot glyph-edit state-done",
      "step-dot glyph-command state-failed",
      "step-dot glyph-search state-rejected",
      "step-dot glyph-fetch state-done",
      "step-dot glyph-command state-live",
    ]);
    expect(screen.getByRole("toolbar", { name: "Steps" })).toBeTruthy();
  });

  it("rings a thought, and makes the last one live while the group runs on it", () => {
    const store = new ActivityDisclosure(null);
    const items = [tool("Read", "a.ts"), thinking("hm")];
    const { rerender } = render(<ActivityGroupView group={group(items)} running store={store} />);
    expect(dots()[1].className).toBe("step-dot glyph-thinking state-live");
    rerender(<ActivityGroupView group={group(items)} running={false} store={store} />);
    expect(dots()[1].className).toBe("step-dot glyph-thinking state-done");
  });

  it("names each step and its time in a tooltip on hover and on focus", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const store = new ActivityDisclosure(null);
    const running = tool("Bash", "npm test", "running");
    const first = group([thinking("plan"), running]);
    const { rerender } = render(<ActivityGroupView group={first} running startedAt={10_000} store={store} />);
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    const [thought, bash] = dotButtons();
    fireEvent.mouseEnter(bash);
    expect(screen.getByRole("tooltip").textContent).toBe("Bash npm test · 3s · running");
    expect(bash.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.mouseLeave(bash);
    expect(screen.queryByRole("tooltip")).toBeNull();

    // The step ends: its time stops, and the tooltip says how it went.
    vi.setSystemTime(14_000);
    rerender(
      <ActivityGroupView group={group([first.items[0], { ...running, status: "error" }])} running startedAt={10_000} store={store} />,
    );
    vi.setSystemTime(30_000);
    fireEvent.focus(dotButtons()[1]);
    expect(screen.getByRole("tooltip").textContent).toBe("Bash npm test · 4s · failed");
    // A thought seen only once it was over has no time to tell.
    fireEvent.focus(thought);
    expect(screen.getByRole("tooltip").textContent).toBe("Thought");
  });

  it("opens the group on a dot's click, and brings its step into view, lit for a moment", () => {
    vi.useFakeTimers();
    const scrolled: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    const store = new ActivityDisclosure(null);
    render(
      <ActivityGroupView
        group={group([tool("Grep", "x", "done", "1"), tool("Read", "a.ts", "done", "2"), tool("Bash", "ls", "done", "3")])}
        running={false}
        store={store}
      />,
    );
    fireEvent.click(dotButtons()[1]);
    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
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
    fireEvent.click(dotButtons()[2]);
    expect(store.isOpen("run-1:0")).toBe(true);
    expect(scrolled[1]).toBe(document.querySelector('.activity-step[data-step-index="2"]'));
  });

  it("keeps to one line: the last dots, after a +k for the earlier ones", () => {
    const items = Array.from({ length: 20 }, (_, i) => tool("Read", `f${i}.ts`));
    render(<ActivityGroupView group={group(items)} running={false} store={new ActivityDisclosure(null)} />);
    expect(document.querySelector(".activity-dots-more")?.textContent).toBe(`+${20 - (STRIP_MAX - 1)}`);
    expect(dotButtons()).toHaveLength(STRIP_MAX - 1);
    expect(dotButtons()[0].getAttribute("aria-label")).toBe(`Read f${20 - (STRIP_MAX - 1)}.ts`);
    expect(dotButtons().at(-1)!.getAttribute("aria-label")).toBe("Read f19.ts");
    // No lead-in when every dot fits.
    cleanup();
    render(<ActivityGroupView group={group(items.slice(0, STRIP_MAX))} running={false} store={new ActivityDisclosure(null)} />);
    expect(document.querySelector(".activity-dots-more")).toBeNull();
    expect(dotButtons()).toHaveLength(STRIP_MAX);
  });

  it("is one tab stop, walked with the arrow keys", () => {
    render(
      <ActivityGroupView
        group={group([tool("Read", "a"), tool("Read", "b"), tool("Read", "c")])}
        running={false}
        store={new ActivityDisclosure(null)}
      />,
    );
    const btns = dotButtons();
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

describe("the live window", () => {
  it("shows only the last three lines of a streaming thought, and follows it", () => {
    const store = new ActivityDisclosure(null);
    const t = { kind: "thinking", id: nextId++, text: "one\ntwo\nthree\nfour" } as const;
    const { rerender } = render(<ActivityGroupView group={group([t])} running store={store} />);
    expect(windowLines()).toEqual(["two", "three", "four"]);
    expect(document.querySelector(".activity-live")?.getAttribute("aria-hidden")).toBe("true");
    rerender(<ActivityGroupView group={group([{ ...t, text: `${t.text}\nfive and` }])} running store={store} />);
    expect(windowLines()).toEqual(["three", "four", "five and"]);
    rerender(<ActivityGroupView group={group([{ ...t, text: `${t.text}\nfive and six` }])} running store={store} />);
    expect(windowLines()).toEqual(["three", "four", "five and six"]);
  });

  it("reads a long thought from its end only", () => {
    const long = `${"word ".repeat(400)}the end`;
    render(<ActivityGroupView group={group([thinking(long)])} running store={new ActivityDisclosure(null)} />);
    const [line] = windowLines();
    expect(line!.endsWith("the end")).toBe(true);
    expect(line!.length).toBeLessThanOrEqual(360);
    expect(line!.startsWith("word ")).toBe(true);
  });

  it("shows the last two lines of a running command's output, in mono", () => {
    render(
      <ActivityGroupView
        group={group([tool("Bash", "npm test", "running", "a\nb\nc\n")])}
        running
        store={new ActivityDisclosure(null)}
      />,
    );
    expect(windowLines()).toEqual(["b", "c"]);
    expect(document.querySelector(".activity-live")?.classList.contains("mono")).toBe(true);
  });

  it("goes when its step ends, and is not drawn for a command with no output yet", () => {
    const store = new ActivityDisclosure(null);
    const t = thinking("thinking it over");
    const { rerender } = render(<ActivityGroupView group={group([t])} running store={store} />);
    expect(windowLines()).toEqual(["thinking it over"]);
    // The next step starts: the thought is over.
    const bash = tool("Bash", "npm test", "running");
    rerender(<ActivityGroupView group={group([t, bash])} running store={store} />);
    expect(document.querySelector(".activity-live")).toBeNull();
    rerender(<ActivityGroupView group={group([t, { ...bash, result: "PASS a.test" }])} running store={store} />);
    expect(windowLines()).toEqual(["PASS a.test"]);
    rerender(<ActivityGroupView group={group([t, { ...bash, status: "done", result: "PASS a.test" }])} running store={store} />);
    expect(document.querySelector(".activity-live")).toBeNull();
    // Nor once the turn stops on it.
    rerender(<ActivityGroupView group={group([t, thinking("more")])} running={false} store={store} />);
    expect(document.querySelector(".activity-live")).toBeNull();
  });

  it("gives way to the timeline when the group is open", () => {
    const store = new ActivityDisclosure(null);
    render(<ActivityGroupView group={group([thinking("a\nb")])} running store={store} />);
    fireEvent.click(header());
    expect(document.querySelector(".activity-live")).toBeNull();
    expect(document.querySelector(".activity-thought-preview")).not.toBeNull();
  });
});

describe("the finished summary", () => {
  it("counts each kind of step as a chip, with a quiet red chip for failures", () => {
    render(
      <ActivityGroupView
        group={group([
          tool("Bash", "a"),
          tool("Bash", "b", "error"),
          tool("Bash", "c"),
          tool("Read", "x"),
          tool("Read", "y"),
          tool("Edit", "x"),
          tool("Grep", "q"),
          tool("WebFetch", "u"),
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
      c.getAttribute("title"),
    ]);
    expect(chips).toEqual([
      ["chip-command", "3", "3 commands"],
      ["chip-read", "2", "2 files read"],
      ["chip-edit", "1", "1 file edited"],
      ["chip-search", "1", "1 search"],
      ["chip-fetch", "1", "1 page fetched"],
      ["chip-agent", "1", "1 agent"],
      ["chip-other", "1", "1 other tool"],
      ["chip-thinking", "2", "2 thoughts"],
    ]);
    expect(document.querySelector(".activity-failed")?.textContent).toBe("1 failed");
  });

  it("leaves out the kinds it has none of, and the failure chip with no failures", () => {
    render(<ActivityGroupView group={group([tool("Read", "x")])} running={false} store={new ActivityDisclosure(null)} />);
    expect([...document.querySelectorAll(".activity-chips .activity-chip")].map((c) => c.textContent)).toEqual(["1"]);
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
  it("puts each step on the line beside its dot, with its time at the right", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const store = new ActivityDisclosure(null);
    store.set("run-1:0", true);
    const read = tool("Read", "a.ts", "running");
    const { rerender } = render(<ActivityGroupView group={group([read])} running startedAt={1_000} store={store} />);
    expect(document.querySelector(".activity-step .step-dot.state-live")).not.toBeNull();
    vi.setSystemTime(3_000);
    const done = { ...read, status: "done" as const };
    rerender(<ActivityGroupView group={group([done, thinking("next\nsteps")])} running startedAt={1_000} store={store} />);
    const steps = [...document.querySelectorAll(".activity-timeline > .activity-step")];
    expect(steps.map((s) => s.querySelector(".activity-rail .step-dot")?.className)).toEqual([
      "step-dot glyph-read state-done",
      "step-dot glyph-thinking state-live",
    ]);
    expect(steps[0].querySelector(".tool-card")).not.toBeNull();
    expect(steps[0].querySelector(".activity-step-time")?.textContent).toBe("2s");
    // The live thought's clock runs with the group's.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(steps[1].querySelector(".activity-step-time")?.textContent).toBe("2s");
  });

  it("shows a thought's last lines until it is opened, all of it then", () => {
    const store = new ActivityDisclosure(null);
    store.set("run-1:0", true);
    render(<ActivityGroupView group={group([thinking("1\n2\n3\n4\n5")])} running={false} store={store} />);
    const toggle = screen.getByRole("button", { name: /Thought/, expanded: false });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const preview = [...document.querySelectorAll(".activity-thought-preview .live-window-line")].map((l) => l.textContent);
    expect(preview).toEqual(["3", "4", "5"]);
    fireEvent.click(toggle);
    expect(document.querySelector(".activity-thought-preview")).toBeNull();
    expect(document.querySelector(".activity-thought .msg-thinking")?.textContent).toBe("1\n2\n3\n4\n5");
  });
});

describe("stepTooltip", () => {
  it("leaves out what it does not know", () => {
    const step = { index: 0, item: tool("Read", "a"), glyph: "read" as const, state: "done" as const, label: "Read a" };
    expect(stepTooltip(step, null)).toBe("Read a");
    expect(stepTooltip({ ...step, state: "rejected" }, "1s")).toBe("Read a · 1s · not run");
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
