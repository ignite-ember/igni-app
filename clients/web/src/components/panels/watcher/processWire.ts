/**
 * The background-process contract, read at the boundary: the
 * ``list_background_processes`` and ``read_process_tail`` answers and
 * the three ``process_*`` push channels.
 */

import type { ServerMessage } from "../../../protocol/messages";
import { WirePayload } from "../../../protocol/wirePayload";

/** The pid a payload names, or ``null`` when it names none. */
function pidOf(p: WirePayload): number | null {
  const pid = Number(p.value("pid"));
  return Number.isFinite(pid) ? pid : null;
}

function exitCodeOf(p: WirePayload): number | null {
  return p.optionalNumber("exit_code") ?? null;
}

/** One entry of ``list_background_processes``. */
export class ListedProcess {
  constructor(
    readonly pid: number,
    readonly cmd: string,
    readonly elapsedSeconds: number,
    readonly isRunning: boolean,
    readonly exitCode: number | null,
  ) {}

  static parse(raw: unknown): ListedProcess | null {
    const p = new WirePayload(raw);
    const pid = pidOf(p);
    if (pid === null) return null;
    return new ListedProcess(pid, p.text("cmd"), p.number("elapsed_seconds"), p.flag("is_running"), exitCodeOf(p));
  }

  static parseList(raw: unknown): ListedProcess[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(ListedProcess.parse).filter((p): p is ListedProcess => p !== null);
  }
}

/** ``read_process_tail``: the recent output of one process and its state. */
export class ProcessTail {
  constructor(
    readonly lines: readonly string[],
    readonly isRunning: boolean,
    readonly exitCode: number | null,
  ) {}

  static parse(raw: unknown): ProcessTail {
    const p = new WirePayload(raw);
    const output = p.string("output");
    return new ProcessTail(output ? output.split("\n") : [], p.flag("is_running"), exitCodeOf(p));
  }
}

export interface ProcessStarted {
  channel: "process_started";
  pid: number;
  cmd: string;
  /** Epoch seconds. */
  startedAt: number;
}

export interface ProcessLine {
  channel: "process_line";
  pid: number;
  line: string;
}

export interface ProcessExited {
  channel: "process_exited";
  pid: number;
  exitCode: number | null;
}

export type ProcessEvent = ProcessStarted | ProcessLine | ProcessExited;
export type ProcessChannel = ProcessEvent["channel"];
export type ProcessEventOf<K extends ProcessChannel> = Extract<ProcessEvent, { channel: K }>;

type Parsers = { [K in ProcessChannel]: (p: WirePayload, pid: number) => ProcessEventOf<K> };

const PARSERS: Parsers = {
  process_started: (p, pid) => ({
    channel: "process_started",
    pid,
    cmd: p.text("cmd"),
    startedAt: p.number("started_at") || Date.now() / 1000,
  }),
  process_line: (p, pid) => ({ channel: "process_line", pid, line: p.text("line") }),
  process_exited: (p, pid) => ({ channel: "process_exited", pid, exitCode: exitCodeOf(p) }),
};

function isProcessChannel(channel: string): channel is ProcessChannel {
  return Object.prototype.hasOwnProperty.call(PARSERS, channel);
}

/** The process event a server message carries, or ``null`` for any other
 *  message or a payload that names no pid. */
export function parseProcessEvent(m: ServerMessage): ProcessEvent | null {
  if (m.type !== "push_notification" || !isProcessChannel(m.channel)) return null;
  const p = new WirePayload(m.payload);
  const pid = pidOf(p);
  if (pid === null) return null;
  const parse = PARSERS[m.channel] as (p: WirePayload, pid: number) => ProcessEvent;
  return parse(p, pid);
}
