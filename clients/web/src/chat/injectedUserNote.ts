/**
 * The note a working turn appends to a tool's result when it takes in
 * the messages queued for it (igni-core ``InjectedNote``): which queued
 * messages that tool call carried to the model.
 */

/** The block's first line, as igni-core writes it. */
const HEADER = "[USER MESSAGE WHILE YOU WERE WORKING]\n";
const FOOTER = "\n[END USER MESSAGE]";

export class InjectedUserNote {
  private constructor(private readonly body: string) {}

  /** The note at the end of a tool's result, or null when it carries none. */
  static in(result: string): InjectedUserNote | null {
    if (!result.endsWith(FOOTER)) return null;
    const start = result.lastIndexOf(HEADER);
    if (start < 0) return null;
    return new InjectedUserNote(result.slice(start + HEADER.length, -FOOTER.length));
  }

  /** How many of ``queued``, oldest first, the note carries. The turn
   *  drains its queue whole and in order, one ``- text`` line each, so
   *  what it took is a run of the oldest queued messages. */
  takenFrom(queued: readonly string[]): number {
    let rest = this.body;
    let taken = 0;
    for (const text of queued) {
      const line = `- ${text}`;
      if (rest === line) return taken + 1;
      if (!rest.startsWith(`${line}\n`)) return taken;
      rest = rest.slice(line.length + 1);
      taken++;
    }
    return taken;
  }
}
