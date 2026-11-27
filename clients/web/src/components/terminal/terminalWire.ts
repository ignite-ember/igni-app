/**
 * The terminal's two push channels, read at the boundary:
 * ``terminal_output`` (the shell's text) and ``terminal_exited`` (its
 * end). igni addresses both to the window that opened the terminal
 * only, so nothing routes them past this pane.
 */

import type { ServerMessage } from "../../protocol/messages";
import { WirePayload } from "../../protocol/wirePayload";

export interface TerminalOutput {
  channel: "terminal_output";
  terminalId: string;
  data: string;
}

export interface TerminalExited {
  channel: "terminal_exited";
  terminalId: string;
  exitCode: number | null;
}

export type TerminalEvent = TerminalOutput | TerminalExited;

/** The terminal event a server message carries, or ``null`` for any
 *  other message or a payload that names no terminal. */
export function parseTerminalEvent(m: ServerMessage): TerminalEvent | null {
  if (m.type !== "push_notification") return null;
  if (m.channel !== "terminal_output" && m.channel !== "terminal_exited") return null;
  const p = new WirePayload(m.payload);
  const terminalId = p.string("terminal_id");
  if (!terminalId) return null;
  if (m.channel === "terminal_output") return { channel: m.channel, terminalId, data: p.string("data") };
  return { channel: m.channel, terminalId, exitCode: p.optionalNumber("exit_code") ?? null };
}
