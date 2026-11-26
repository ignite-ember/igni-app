// @vitest-environment jsdom
/**
 * The terminal pane against a fake connection, with xterm stood in for:
 * jsdom has no layout to measure cells in, and what is tested here is
 * the wiring — what is sent to igni, and what reaches the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

import { useHitl } from "../../chat/useHitl";
import { useChatSearch } from "../../chat/useChatSearch";
import { WindowModel } from "../../clientState";
import { TerminalOpened } from "../../protocol/backendCallResults";
import { RpcError } from "../../protocol/client";
import { RECONNECTED_LINE } from "./terminalSession";
import { RESIZE_DEBOUNCE_MS, TerminalPane } from "./TerminalPane";

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
    focused = false;
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
      this.focused = true;
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
  const calls = {
    terminalOpen: vi.fn(async (_cols: number, _rows: number) => new TerminalOpened("t1", "/bin/zsh", "/repo")),
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

async function mount(connected = true, onClose = vi.fn()) {
  const conn = fakeConnection();
  const view = render(
    <TerminalPane
      client={conn.client as never}
      connected={connected}
      maximized={false}
      onToggleMaximize={() => {}}
      onClose={onClose}
    />,
  );
  await act(async () => {});
  const term = xterm.FakeTerminal.all[xterm.FakeTerminal.all.length - 1];
  return { ...conn, view, term };
}

describe("TerminalPane", () => {
  it("opens a shell at the fitted size and names it in the head", async () => {
    const { calls, term } = await mount();
    expect(calls.terminalOpen).toHaveBeenCalledExactlyOnceWith(80, 24);
    expect(term.focused).toBe(true);
    expect(screen.getByText("zsh").getAttribute("title")).toBe("/repo");
  });

  it("waits for the connection before opening", async () => {
    const { calls, state } = await mount(false);
    expect(calls.terminalOpen).not.toHaveBeenCalled();
    await state("connected");
    expect(calls.terminalOpen).toHaveBeenCalledTimes(1);
  });

  it("writes this terminal's output and ignores another's", async () => {
    const { push, term } = await mount();
    await push("terminal_output", { terminal_id: "t1", data: "$ " });
    await push("terminal_output", { terminal_id: "other", data: "nope" });
    await push("process_line", { pid: 1, line: "nope" });
    expect(term.screen).toBe("$ ");
  });

  it("sends what is typed", async () => {
    const { calls, term } = await mount();
    act(() => term.type("ls\r"));
    expect(calls.terminalInput).toHaveBeenCalledExactlyOnceWith("t1", "ls\r");
  });

  it("refits on a resize and tells igni the new size once it settles", async () => {
    const { calls, term } = await mount();
    vi.useFakeTimers();
    term.fitsTo = { cols: 100, rows: 30 };
    act(() => observers.forEach((fire) => fire()));
    act(() => observers.forEach((fire) => fire()));
    expect(calls.terminalResize).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS));
    expect(calls.terminalResize).toHaveBeenCalledExactlyOnceWith("t1", 100, 30);
    // The same size again is not news.
    act(() => observers.forEach((fire) => fire()));
    act(() => vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS));
    expect(calls.terminalResize).toHaveBeenCalledTimes(1);
  });

  it("says the shell exited, and Enter starts a new one", async () => {
    const { calls, push, term } = await mount();
    await push("terminal_exited", { terminal_id: "t1", exit_code: 3 });
    expect(term.screen).toContain("[process exited with code 3]");
    expect(screen.getByText("Press Enter to start a new shell.")).toBeTruthy();
    act(() => term.type("x"));
    expect(calls.terminalInput).not.toHaveBeenCalled();
    await act(async () => term.type("\r"));
    expect(calls.terminalOpen).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Press Enter to start a new shell.")).toBeNull();
  });

  it("starts a new shell from the button after an exit", async () => {
    const { calls, push } = await mount();
    await push("terminal_exited", { terminal_id: "t1", exit_code: null });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New shell" })));
    expect(calls.terminalOpen).toHaveBeenCalledTimes(2);
  });

  it("opens a new shell when the connection comes back, and says so", async () => {
    const { calls, state, term } = await mount();
    await state("disconnected");
    act(() => term.type("lost"));
    expect(calls.terminalInput).not.toHaveBeenCalled();
    calls.terminalOpen.mockResolvedValueOnce(new TerminalOpened("t2", "/bin/zsh", "/repo"));
    await state("connected");
    expect(calls.terminalOpen).toHaveBeenCalledTimes(2);
    expect(term.screen).toContain(RECONNECTED_LINE);
    act(() => term.type("a"));
    expect(calls.terminalInput).toHaveBeenCalledWith("t2", "a");
  });

  it("shows a refusal plainly and does not ask again", async () => {
    const conn = fakeConnection();
    conn.calls.terminalOpen.mockRejectedValue(
      new RpcError("terminal_open: Terminals are turned off by policy.", "refused"),
    );
    render(
      <TerminalPane client={conn.client as never} connected maximized={false} onToggleMaximize={() => {}} onClose={() => {}} />,
    );
    expect(await screen.findByText("Terminals are turned off by policy.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await conn.state("disconnected");
    await conn.state("connected");
    expect(conn.calls.terminalOpen).toHaveBeenCalledTimes(1);
  });

  it("offers to try again after a failure that is not a refusal", async () => {
    const conn = fakeConnection();
    conn.calls.terminalOpen.mockRejectedValueOnce(new Error("RPC terminal_open timed out"));
    render(
      <TerminalPane client={conn.client as never} connected maximized={false} onToggleMaximize={() => {}} onClose={() => {}} />,
    );
    const again = await screen.findByRole("button", { name: "Try again" });
    await act(async () => fireEvent.click(again));
    expect(conn.calls.terminalOpen).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("RPC terminal_open timed out")).toBeNull();
  });

  it("follows the document's theme", async () => {
    const { term } = await mount();
    const before = term.options.theme;
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "light");
      await Promise.resolve();
    });
    expect(term.options.theme).not.toBe(before);
    document.documentElement.removeAttribute("data-theme");
  });

  it("closes the shell when the pane goes", async () => {
    const { calls, view, term } = await mount();
    view.unmount();
    expect(calls.terminalClose).toHaveBeenCalledExactlyOnceWith("t1");
    expect(term.disposed).toBe(true);
  });

  it("closes from its head", async () => {
    const onClose = vi.fn();
    await mount(true, onClose);
    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the terminal owns the keyboard", () => {
  it("Escape typed in it does not cancel a run", async () => {
    const run = { runPhaseRef: { current: "streaming" as const }, cancel: vi.fn() };
    renderHook(() => useHitl({ resolveHitlBatch: vi.fn(async () => {}) }, run));
    const { term } = await mount();
    act(() => {
      term.textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(run.cancel).not.toHaveBeenCalled();
    // The same key outside it still does.
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
      term.textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
    });
    expect(toggle).not.toHaveBeenCalled();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
    });
    expect(toggle).toHaveBeenCalledWith("search");
  });
});
