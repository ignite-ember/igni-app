import { describe, expect, it, vi } from "vitest";

import { TerminalOpened } from "../../protocol/backendCallResults";
import { RpcError } from "../../protocol/client";
import { RECONNECTED_LINE, TerminalSession, exitedLine, type TerminalPhase } from "./terminalSession";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const written: string[] = [];
  const phases: TerminalPhase[] = [];
  const calls = {
    terminalOpen: vi.fn(async () => new TerminalOpened("t1", "/bin/bash", "/w")),
    terminalInput: vi.fn(async () => {}),
    terminalResize: vi.fn(async () => {}),
    terminalClose: vi.fn(async () => {}),
  };
  const session = new TerminalSession(
    calls,
    { write: (t) => written.push(t), size: () => ({ cols: 90, rows: 20 }) },
    (p) => phases.push(p),
  );
  return { session, calls, written, phases, screen: () => written.join("") };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const output = (terminalId: string, data: string) => ({ channel: "terminal_output" as const, terminalId, data });

describe("TerminalSession", () => {
  it("keeps output that arrives before the open answers, for its own terminal", async () => {
    const { session, calls, screen } = setup();
    const open = deferred<TerminalOpened>();
    calls.terminalOpen.mockReturnValueOnce(open.promise);
    session.connected();
    session.event(output("t9", "hello "));
    session.event(output("other", "nope"));
    open.resolve(new TerminalOpened("t9", "", ""));
    await flush();
    expect(screen()).toBe("hello ");
    expect(session.current).toMatchObject({ kind: "open", terminalId: "t9" });
  });

  it("closes a shell whose open answered after the connection dropped", async () => {
    const { session, calls } = setup();
    const open = deferred<TerminalOpened>();
    calls.terminalOpen.mockReturnValueOnce(open.promise);
    session.connected();
    session.disconnected();
    expect(session.current.kind).toBe("idle");
    open.resolve(new TerminalOpened("late", "", ""));
    await flush();
    expect(calls.terminalClose).toHaveBeenCalledWith("late");
    expect(session.current.kind).toBe("idle");
  });

  it("an open lost with its connection is tried again on the next one", async () => {
    const { session, calls, screen } = setup();
    const open = deferred<TerminalOpened>();
    calls.terminalOpen.mockReturnValueOnce(open.promise);
    session.connected();
    // The socket closes under the call before the session hears of it.
    (session as unknown as { online: boolean }).online = false;
    open.reject(new Error("connection closed"));
    await flush();
    expect(session.current.kind).toBe("idle");
    session.connected();
    await flush();
    expect(session.current.kind).toBe("open");
    // No shell was had, so this is not a reconnect.
    expect(screen()).not.toContain(RECONNECTED_LINE);
  });

  it("a resync behind the same socket replaces the shell", async () => {
    const { session, calls, screen } = setup();
    session.connected();
    await flush();
    calls.terminalOpen.mockResolvedValueOnce(new TerminalOpened("t2", "", ""));
    session.connected();
    await flush();
    expect(calls.terminalClose).toHaveBeenCalledWith("t1");
    expect(session.current).toMatchObject({ terminalId: "t2" });
    expect(screen()).toContain(RECONNECTED_LINE);
  });

  it("an answer without a terminal is a failure the next connection retries", async () => {
    const { session, calls } = setup();
    calls.terminalOpen.mockResolvedValueOnce(new TerminalOpened("", "", ""));
    session.connected();
    await flush();
    expect(session.current).toEqual({ kind: "failed", message: "igni started no terminal", final: false });
    session.connected();
    await flush();
    expect(session.current.kind).toBe("open");
  });

  it("an igni without terminals is final", async () => {
    const { session, calls } = setup();
    calls.terminalOpen.mockRejectedValueOnce(new RpcError("unknown method: terminal_open", "unknown_method"));
    session.connected();
    await flush();
    expect(session.current).toMatchObject({ kind: "failed", final: true });
  });

  it("does nothing with input, a resize or a restart while no shell runs", async () => {
    const { session, calls } = setup();
    session.input("x");
    session.resize(1, 1);
    session.restart();
    expect(calls.terminalInput).not.toHaveBeenCalled();
    expect(calls.terminalResize).not.toHaveBeenCalled();
    expect(calls.terminalOpen).not.toHaveBeenCalled();
    session.connected();
    await flush();
    session.restart();
    expect(calls.terminalOpen).toHaveBeenCalledTimes(1);
  });

  it("stays ended across a reconnect until asked", async () => {
    const { session, calls } = setup();
    session.connected();
    await flush();
    session.event({ channel: "terminal_exited", terminalId: "t1", exitCode: 0 });
    session.disconnected();
    session.connected();
    expect(calls.terminalOpen).toHaveBeenCalledTimes(1);
  });

  it("reports no phase after it is disposed", async () => {
    const { session, calls, phases } = setup();
    const open = deferred<TerminalOpened>();
    calls.terminalOpen.mockReturnValueOnce(open.promise);
    session.connected();
    session.dispose();
    const seen = phases.length;
    open.resolve(new TerminalOpened("t1", "", ""));
    await flush();
    expect(phases.length).toBe(seen);
    expect(calls.terminalClose).toHaveBeenCalledWith("t1");
  });

  it("words an exit with and without a code", () => {
    expect(exitedLine(0)).toBe("[process exited with code 0]");
    expect(exitedLine(null)).toBe("[process exited]");
  });
});
