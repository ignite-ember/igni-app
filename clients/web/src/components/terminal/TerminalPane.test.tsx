// @vitest-environment jsdom
/**
 * The terminal's tabs against a fake connection, with xterm stood in for:
 * jsdom has no layout to measure cells in, and what is tested here is
 * the wiring — what is sent to igni, what reaches each tab's screen, and
 * that hiding the pane ends nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

import { useHitl } from "../../chat/useHitl";
import { useChatSearch } from "../../chat/useChatSearch";
import { WindowModel } from "../../clientState";
import { TerminalOpened } from "../../protocol/backendCallResults";
import { RpcError } from "../../protocol/client";
import { NOTICE_MS, numberedLabels } from "./terminalManager";
import { RECONNECTED_LINE } from "./terminalSession";
import { RESIZE_DEBOUNCE_MS, TerminalPane } from "./TerminalPane";
import { useTerminals } from "./useTerminals";

const xterm = vi.hoisted(() => {
  class FakeTerminal {
    static all: FakeTerminal[] = [];
    cols = 80;
    rows = 24;
    /** The size the next fit lands on. */
    fitsTo: { cols: number; rows: number } | null = null;
    written: string[] = [];
    options: Record<string, unknown>;
    disposed = false;
    focused = 0;
    refreshed = 0;
    private dataListener: ((data: string) => void) | null = null;
    textarea: HTMLTextAreaElement | null = null;
    constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      FakeTerminal.all.push(this);
    }
    loadAddon(addon: { term?: FakeTerminal }) {
      addon.term = this;
    }
    open(el: HTMLElement) {
      this.textarea = document.createElement("textarea");
      this.textarea.setAttribute("aria-label", "Terminal input");
      el.appendChild(this.textarea);
    }
    onData(fn: (data: string) => void) {
      this.dataListener = fn;
      return { dispose: () => (this.dataListener = null) };
    }
    type(data: string) {
      this.dataListener?.(data);
    }
    write(text: string) {
      this.written.push(text);
    }
    focus() {
      this.focused += 1;
    }
    refresh() {
      this.refreshed += 1;
    }
    dispose() {
      this.disposed = true;
    }
    get screen(): string {
      return this.written.join("");
    }
  }
  class FakeFit {
    term?: FakeTerminal;
    fit() {
      if (this.term?.fitsTo) Object.assign(this.term, this.term.fitsTo);
    }
  }
  return { FakeTerminal, FakeFit };
});

vi.mock("@xterm/xterm", () => ({ Terminal: xterm.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: xterm.FakeFit }));

type Listener<T> = (value: T) => void;

let observers: Array<() => void> = [];

beforeEach(() => {
  xterm.FakeTerminal.all = [];
  observers = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(private readonly cb: () => void) {
      observers.push(() => this.cb());
    }
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fakeConnection() {
  const events = new Set<Listener<unknown>>();
  const states = new Set<Listener<string>>();
  let n = 0;
  const calls = {
    terminalOpen: vi.fn(async (_cols: number, _rows: number) => new TerminalOpened(`t${++n}`, "/bin/zsh", "/repo")),
    terminalInput: vi.fn(async (_id: string, _data: string) => {}),
    terminalResize: vi.fn(async (_id: string, _cols: number, _rows: number) => {}),
    terminalClose: vi.fn(async (_id: string) => {}),
  };
  const client = {
    calls,
    onEvent: (fn: Listener<unknown>) => {
      events.add(fn);
      return () => events.delete(fn);
    },
    onStateChange: (fn: Listener<string>) => {
      states.add(fn);
      return () => states.delete(fn);
    },
  };
  return {
    client,
    calls,
    push: async (channel: string, payload: Record<string, unknown>) => {
      await act(async () => events.forEach((fn) => fn({ type: "push_notification", channel, payload })));
    },
    state: async (s: string) => {
      await act(async () => states.forEach((fn) => fn(s)));
    },
  };
}

type Conn = ReturnType<typeof fakeConnection>;

/** The window: its terminals held above a pane that can be hidden. */
function Window({
  conn,
  connected,
  shown,
  onClose,
}: {
  conn: Conn;
  connected: boolean;
  shown: boolean;
  onClose: () => void;
}) {
  const terminals = useTerminals(conn.client as never, connected);
  return shown ? (
    <TerminalPane terminals={terminals} maximized={false} onToggleMaximize={() => {}} onClose={onClose} />
  ) : null;
}

async function mount({ connected = true, onClose = vi.fn(), conn = fakeConnection() } = {}) {
  const view = render(<Window conn={conn} connected={connected} shown onClose={onClose} />);
  await act(async () => {});
  const show = async (shown: boolean) => {
    view.rerender(<Window conn={conn} connected={connected} shown={shown} onClose={onClose} />);
    await act(async () => {});
  };
  const term = (i = xterm.FakeTerminal.all.length - 1) => xterm.FakeTerminal.all[i];
  return { ...conn, view, show, term, onClose };
}

const tabs = () => screen.queryAllByRole("tab");
const newTab = async () => {
  await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "New terminal" })[0]));
};

describe("the terminal pane", () => {
  it("opens a first tab at the fitted size, named after its shell", async () => {
    const { calls, term } = await mount();
    expect(calls.terminalOpen).toHaveBeenCalledExactlyOnceWith(80, 24);
    expect(term().focused).toBeGreaterThan(0);
    expect(tabs().map((t) => t.textContent)).toEqual(["zsh"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs()[0].id);
    expect(screen.getByRole("tablist").getAttribute("aria-owns")).toBe(tabs()[0].id);
  });

  it("waits for the connection before opening", async () => {
    const { calls, state } = await mount({ connected: false });
    expect(calls.terminalOpen).not.toHaveBeenCalled();
    await state("connected");
    expect(calls.terminalOpen).toHaveBeenCalledTimes(1);
  });

  it("writes a tab's own output and ignores another's", async () => {
    const { push, term } = await mount();
    await push("terminal_output", { terminal_id: "t1", data: "$ " });
    await push("terminal_output", { terminal_id: "other", data: "nope" });
    await push("process_line", { pid: 1, line: "nope" });
    expect(term().screen).toBe("$ ");
  });

  it("sends what is typed", async () => {
    const { calls, term } = await mount();
    act(() => term().type("ls\r"));
    expect(calls.terminalInput).toHaveBeenCalledExactlyOnceWith("t1", "ls\r");
  });

  it("refits on a resize and tells igni the new size once it settles", async () => {
    const { calls, term } = await mount();
    vi.useFakeTimers();
    term().fitsTo = { cols: 100, rows: 30 };
    act(() => observers.forEach((fire) => fire()));
    act(() => observers.forEach((fire) => fire()));
    expect(calls.terminalResize).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS));
    expect(calls.terminalResize).toHaveBeenCalledExactlyOnceWith("t1", 100, 30);
    act(() => observers.forEach((fire) => fire()));
    act(() => vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS));
    expect(calls.terminalResize).toHaveBeenCalledTimes(1);
  });

  it("hiding and showing keeps the shells, their ids and what came meanwhile", async () => {
    const { calls, push, show, term } = await mount();
    act(() => term().type("a"));
    await show(false);
    expect(calls.terminalClose).not.toHaveBeenCalled();
    await push("terminal_output", { terminal_id: "t1", data: "while hidden" });
    await show(true);
    expect(calls.terminalOpen).toHaveBeenCalledTimes(1);
    expect(xterm.FakeTerminal.all).toHaveLength(1);
    expect(term().screen).toContain("while hidden");
    expect(screen.getByRole("tabpanel").contains(term().textarea)).toBe(true);
    expect(term().refreshed).toBeGreaterThan(0);
    act(() => term().type("b"));
    expect(calls.terminalInput.mock.calls.map((c) => c[0])).toEqual(["t1", "t1"]);
  });

  it("a new tab opens its own shell and takes the focus", async () => {
    const { calls, term } = await mount();
    await newTab();
    expect(calls.terminalOpen).toHaveBeenCalledTimes(2);
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(term(1).focused).toBeGreaterThan(0);
    act(() => term(1).type("x"));
    expect(calls.terminalInput).toHaveBeenCalledWith("t2", "x");
  });

  it("⌃⇧` in the terminal opens a new tab", async () => {
    const { calls, term } = await mount();
    await act(async () => {
      term().textarea!.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Backquote", key: "~", ctrlKey: true, shiftKey: true, bubbles: true }),
      );
    });
    expect(calls.terminalOpen).toHaveBeenCalledTimes(2);
    expect(tabs()).toHaveLength(2);
  });

  it("numbers tabs that share a shell's name", async () => {
    await mount();
    await newTab();
    await newTab();
    expect(tabs().map((t) => t.textContent)).toEqual(["zsh", "zsh 2", "zsh 3"]);
    expect(numberedLabels(["zsh", "bash", "zsh"])).toEqual(["zsh", "bash", "zsh 2"]);
  });

  it("switching tabs shows that tab's screen, fitted and sized", async () => {
    const { calls, term } = await mount();
    await newTab();
    term(0).fitsTo = { cols: 90, rows: 20 };
    await act(async () => fireEvent.click(tabs()[0]));
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").contains(term(0).textarea)).toBe(true);
    expect(screen.getByRole("tabpanel").contains(term(1).textarea)).toBe(false);
    expect(calls.terminalResize).toHaveBeenCalledExactlyOnceWith("t1", 90, 20);
  });

  it("closing a tab closes that shell only", async () => {
    const { calls, term } = await mount();
    await newTab();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close terminal zsh" })));
    expect(calls.terminalClose).toHaveBeenCalledExactlyOnceWith("t1");
    expect(term(0).disposed).toBe(true);
    expect(tabs().map((t) => t.textContent)).toEqual(["zsh"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("closing the last tab leaves a way to open another", async () => {
    const { calls, onClose } = await mount();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close terminal zsh" })));
    expect(tabs()).toEqual([]);
    expect(screen.getByText("No terminals open.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "New terminal" })[1]));
    expect(calls.terminalOpen).toHaveBeenCalledTimes(2);
    expect(tabs()).toHaveLength(1);
  });

  it("a ninth terminal igni refuses goes, with its message, and the rest stay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = await mount();
    calls.terminalOpen.mockRejectedValueOnce(
      new RpcError("terminal_open: this window already has 8 terminals open", "refused"),
    );
    await newTab();
    expect(tabs()).toHaveLength(1);
    expect(screen.getByText("this window already has 8 terminals open")).toBeTruthy();
    expect(calls.terminalClose).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(NOTICE_MS));
    expect(screen.queryByText("this window already has 8 terminals open")).toBeNull();
  });

  it("an exited shell's tab is marked, and Enter starts a new one", async () => {
    const { calls, push, term } = await mount();
    await push("terminal_exited", { terminal_id: "t1", exit_code: 3 });
    expect(term().screen).toContain("[process exited with code 3]");
    expect(tabs()[0].parentElement!.className).toContain("is-exited");
    expect(tabs()[0].textContent).toBe("zsh exited");
    expect(screen.getByText("Press Enter to start a new shell.")).toBeTruthy();
    act(() => term().type("x"));
    expect(calls.terminalInput).not.toHaveBeenCalled();
    await act(async () => term().type("\r"));
    expect(calls.terminalOpen).toHaveBeenCalledTimes(2);
    expect(tabs()[0].parentElement!.className).not.toContain("is-exited");
  });

  it("starts a new shell from the button after an exit", async () => {
    const { calls, push } = await mount();
    await push("terminal_exited", { terminal_id: "t1", exit_code: null });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New shell" })));
    expect(calls.terminalOpen).toHaveBeenCalledTimes(2);
  });

  it("a dropped connection gives every tab a new shell when it comes back", async () => {
    const { calls, state, term, show } = await mount();
    await newTab();
    await show(false);
    await state("disconnected");
    act(() => term(0).type("lost"));
    expect(calls.terminalInput).not.toHaveBeenCalled();
    await state("connected");
    expect(calls.terminalOpen).toHaveBeenCalledTimes(4);
    expect(term(0).screen).toContain(RECONNECTED_LINE);
    expect(term(1).screen).toContain(RECONNECTED_LINE);
    act(() => term(0).type("a"));
    act(() => term(1).type("b"));
    expect(calls.terminalInput.mock.calls).toEqual([
      ["t3", "a"],
      ["t4", "b"],
    ]);
  });

  it("shows a refusal of the first terminal plainly and does not ask again", async () => {
    const conn = fakeConnection();
    conn.calls.terminalOpen.mockRejectedValue(
      new RpcError("terminal_open: Terminals are turned off by policy.", "refused"),
    );
    await mount({ conn });
    expect(screen.getByText("Terminals are turned off by policy.")).toBeTruthy();
    expect(tabs()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await conn.state("disconnected");
    await conn.state("connected");
    expect(conn.calls.terminalOpen).toHaveBeenCalledTimes(1);
  });

  it("offers to try again after a failure that is not a refusal", async () => {
    const conn = fakeConnection();
    conn.calls.terminalOpen.mockRejectedValueOnce(new Error("RPC terminal_open timed out"));
    await mount({ conn });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(conn.calls.terminalOpen).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("RPC terminal_open timed out")).toBeNull();
  });

  it("follows the document's theme, shown or not", async () => {
    const { term, show } = await mount();
    await show(false);
    const before = term().options.theme;
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "light");
      await Promise.resolve();
    });
    expect(term().options.theme).not.toBe(before);
    document.documentElement.removeAttribute("data-theme");
  });

  it("closes every shell when the window goes", async () => {
    const { calls, view, term } = await mount();
    await newTab();
    view.unmount();
    expect(calls.terminalClose.mock.calls.map((c) => c[0]).sort()).toEqual(["t1", "t2"]);
    expect(term(0).disposed && term(1).disposed).toBe(true);
  });

  it("hides from its head without closing anything", async () => {
    const onClose = vi.fn();
    const { calls } = await mount({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Hide terminal" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls.terminalClose).not.toHaveBeenCalled();
  });
});

describe("the terminal owns the keyboard", () => {
  it("Escape typed in it does not cancel a run", async () => {
    const run = { runPhaseRef: { current: "streaming" as const }, cancel: vi.fn() };
    renderHook(() => useHitl({ resolveHitlBatch: vi.fn(async () => {}) }, run));
    const { term } = await mount();
    act(() => {
      term().textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(run.cancel).not.toHaveBeenCalled();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(run.cancel).toHaveBeenCalledTimes(1);
  });

  it("⌘F typed in it does not open the chat's find", async () => {
    const model = new WindowModel(
      { rpc: vi.fn(async () => ({ rev: 1 })), onEvent: () => () => {} } as never,
      "w-1",
    );
    const toggle = vi.spyOn(model, "togglePanel");
    renderHook(() => useChatSearch(model, [{ id: 1 }] as never, { current: null }, null));
    const { term } = await mount();
    act(() => {
      term().textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
    });
    expect(toggle).not.toHaveBeenCalled();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
    });
    expect(toggle).toHaveBeenCalledWith("search");
  });
});
