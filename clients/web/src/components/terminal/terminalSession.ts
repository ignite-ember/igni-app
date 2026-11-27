/**
 * One window's terminal over the backend connection, without React or
 * xterm: when to open a shell, what to do with its output, and what a
 * dropped connection or a shell that ended means for the pane.
 *
 * A shell lives as long as the connection that opened it. When the
 * connection drops (a VM that went to sleep, a node move, a restart)
 * igni ends the shell with it, so the next connection opens a new one
 * and says so in a dim line. A shell that ends by itself stays ended
 * until the person asks for another (Enter, or the pane's button). A
 * refusal — terminals turned off by policy, or none on this igni — is
 * shown once and not retried until the pane is opened again.
 */

import type { BackendCalls } from "../../protocol/backendCalls";
import type { TerminalEvent } from "./terminalWire";

/** What the pane shows besides the shell's own text. */
export type TerminalPhase =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "open"; terminalId: string; shell: string; cwd: string }
  | { kind: "exited"; exitCode: number | null }
  /** ``final``: igni said there is no terminal here, so the next
   *  connection does not ask again. */
  | { kind: "failed"; message: string; final: boolean; code: string | null };

/** Where the session draws: xterm in the pane, a fake in tests. */
export interface TerminalScreen {
  /** The shell's output, as it came. */
  write(text: string): void;
  /** The terminal's size now, in cells. */
  size(): { cols: number; rows: number };
}

export type TerminalCalls = Pick<
  BackendCalls,
  "terminalOpen" | "terminalInput" | "terminalResize" | "terminalClose"
>;

/** Error codes that mean "no terminal here": not worth asking again
 *  on the next connection. ``unknown_method`` is an igni older than
 *  terminals. */
const FINAL_CODES = new Set(["refused", "unavailable", "unknown_method"]);

/** The most output kept for a terminal whose open has not answered yet. */
const EARLY_OUTPUT_CAP = 256;

/** A line the pane writes itself, dimmed so it reads as not the shell's. */
export function dimLine(text: string): string {
  return `\r\n\x1b[2m${text}\x1b[0m\r\n`;
}

export function exitedLine(exitCode: number | null): string {
  return exitCode === null ? "[process exited]" : `[process exited with code ${exitCode}]`;
}

export const RECONNECTED_LINE = "[reconnected — new shell]";

/** The error's sentence, without the method name igni puts before it. */
function errorMessage(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^terminal_open:\s*/, "");
}

function errorCode(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

export class TerminalSession {
  private phase: TerminalPhase = { kind: "idle" };
  /** Bumped by every open and every drop, so an answer to an open the
   *  session has since moved past is recognised as stale. */
  private epoch = 0;
  /** Whether a shell was ever opened here: the next one after a drop is
   *  announced as a reconnect. */
  private hadShell = false;
  /** Whether a shell was ever opened here. */
  get everOpened(): boolean {
    return this.hadShell;
  }

  /** Whether the connection is up, as last told. */
  private online = false;
  /** Output that arrived before ``terminal_open`` answered. */
  private early: TerminalEvent[] = [];
  private disposed = false;

  constructor(
    private readonly calls: TerminalCalls,
    private readonly screen: TerminalScreen,
    private readonly onPhase: (phase: TerminalPhase) => void,
  ) {}

  get current(): TerminalPhase {
    return this.phase;
  }

  /** The connection came up — or came back, behind the same socket. */
  connected(): void {
    this.online = true;
    if (this.phase.kind === "exited" || (this.phase.kind === "failed" && this.phase.final)) return;
    void this.open(this.hadShell);
  }

  /** The connection dropped, and the shell with it. */
  disconnected(): void {
    this.online = false;
    if (this.phase.kind === "open" || this.phase.kind === "opening") {
      this.epoch += 1;
      this.early = [];
      this.set({ kind: "idle" });
    }
  }

  /** Start a new shell after the last one ended or could not start. */
  restart(): void {
    if (!this.online || this.phase.kind === "open" || this.phase.kind === "opening") return;
    void this.open(false);
  }

  /** Keystrokes from xterm. Enter on an ended shell starts a new one. */
  input(data: string): void {
    if (this.phase.kind === "open") {
      void this.calls.terminalInput(this.phase.terminalId, data).catch(() => undefined);
    } else if (this.phase.kind === "exited" && data === "\r") {
      this.restart();
    }
  }

  /** The pane was resized to ``cols`` × ``rows`` cells. */
  resize(cols: number, rows: number): void {
    if (this.phase.kind !== "open") return;
    void this.calls.terminalResize(this.phase.terminalId, cols, rows).catch(() => undefined);
  }

  /** A push for some terminal; one that is not this window's is ignored. */
  event(ev: TerminalEvent): void {
    if (this.phase.kind === "opening") {
      if (this.early.length < EARLY_OUTPUT_CAP) this.early.push(ev);
      return;
    }
    if (this.phase.kind !== "open" || ev.terminalId !== this.phase.terminalId) return;
    if (ev.channel === "terminal_output") {
      this.screen.write(ev.data);
      return;
    }
    this.screen.write(dimLine(exitedLine(ev.exitCode)));
    this.set({ kind: "exited", exitCode: ev.exitCode });
  }

  /** The pane closed: end the shell. */
  dispose(): void {
    this.disposed = true;
    this.epoch += 1;
    if (this.phase.kind === "open") {
      void this.calls.terminalClose(this.phase.terminalId).catch(() => undefined);
    }
  }

  private async open(reconnect: boolean): Promise<void> {
    // A resync behind the same socket: the shell it had is igni's to
    // forget, but say so in case it is still there.
    if (this.phase.kind === "open") {
      void this.calls.terminalClose(this.phase.terminalId).catch(() => undefined);
    }
    const epoch = ++this.epoch;
    this.early = [];
    this.set({ kind: "opening" });
    const { cols, rows } = this.screen.size();
    try {
      const opened = await this.calls.terminalOpen(cols, rows);
      if (epoch !== this.epoch) {
        // The connection dropped or the pane closed meanwhile; a shell
        // igni did start is closed rather than left running.
        if (opened.terminalId) void this.calls.terminalClose(opened.terminalId).catch(() => undefined);
        return;
      }
      if (!opened.terminalId) throw new Error("igni started no terminal");
      this.hadShell = true;
      if (reconnect) this.screen.write(dimLine(RECONNECTED_LINE));
      this.set({ kind: "open", terminalId: opened.terminalId, shell: opened.shell, cwd: opened.cwd });
      const early = this.early;
      this.early = [];
      for (const ev of early) this.event(ev);
    } catch (e) {
      if (epoch !== this.epoch) return;
      const code = errorCode(e);
      const final = FINAL_CODES.has(code ?? "");
      // A call lost with its connection is not an answer: the next
      // connection tries again.
      if (!this.online && !final) {
        this.set({ kind: "idle" });
        return;
      }
      this.set({ kind: "failed", message: errorMessage(e), final, code });
    }
  }

  private set(phase: TerminalPhase): void {
    this.phase = phase;
    if (!this.disposed) this.onPhase(phase);
  }
}
