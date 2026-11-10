/**
 * The text of a user message as the backend persisted it, with the
 * wrappers the backend adds: injected ``<system-context>``, the
 * ``<attached-files>`` hint, an extension's ``<extension-message>``, and
 * the ``<loop-iteration>`` prompt of a ``/loop`` run.
 */

/** A message an extension posted (``host.chat.post``). */
export interface ExtensionMessage {
  from: string;
  body: string;
}

/** One ``/loop`` iteration, out of its wrapper (``core/loop/prompt.py``). */
export interface LoopIteration {
  index: number;
  total: number | null;
  body: string;
}

/** How a user bubble is styled: a slash command, a ``$`` shell line, or chat. */
export type UserMessageMode = "command" | "shell" | "chat";

export class UserMessageText {
  private static readonly SYSTEM_CONTEXT = /<system-context>[\s\S]*?<\/system-context>\s*/g;
  private static readonly ATTACHED_FILES = /<attached-files>[\s\S]*?<\/attached-files>\s*/g;
  /** Only a wrapper at the very start counts when classifying. */
  private static readonly LEADING_SYSTEM_CONTEXT = /^<system-context>[\s\S]*?<\/system-context>\s*/;
  private static readonly LEADING_ATTACHED_FILES = /^<attached-files>[\s\S]*?<\/attached-files>\s*/;
  /** The backend's ``ExtensionMessage.wrap``. */
  private static readonly EXTENSION_MESSAGE =
    /^<extension-message from="([^"]+)">\n?([\s\S]*?)\n?<\/extension-message>$/;
  private static readonly LOOP_OPEN = /^<loop-iteration\s+index="(\d+)"(?:\s+total="(\d+)")?>\s*\n/;
  private static readonly LOOP_CLOSE = "</loop-iteration>";
  /** Matched by their opening phrases so blank lines inside the
   *  user's own prompt survive. */
  private static readonly LOOP_BOILERPLATE = [
    /^Autonomous loop iteration[\s\S]*?\n\n/,
    /^When you can determine[\s\S]*?\n\n/,
  ];
  /** Closed think blocks, plus a trailing unclosed one: a cancelled run
   *  can persist mid-thought. */
  private static readonly THINK_BLOCK = /<think>[\s\S]*?(<\/think>\s*|$)/g;

  constructor(private readonly raw: string) {}

  static stripThinkBlocks(text: string): string {
    return text.replace(UserMessageText.THINK_BLOCK, "").trim();
  }

  /** What the person typed: the injected wrappers removed. */
  visible(): string {
    return this.raw
      .replace(UserMessageText.SYSTEM_CONTEXT, "")
      .replace(UserMessageText.ATTACHED_FILES, "")
      .trim();
  }

  /** Classified on the text after the leading wrappers, untrimmed, so
   *  ``"  /foo"`` is chat, not a command. */
  mode(): UserMessageMode {
    const typed = this.raw
      .replace(UserMessageText.LEADING_SYSTEM_CONTEXT, "")
      .replace(UserMessageText.LEADING_ATTACHED_FILES, "");
    if (typed.startsWith("/")) return "command";
    if (typed.startsWith("$")) return "shell";
    return "chat";
  }

  isLoopIteration(): boolean {
    return this.raw.startsWith("<loop-iteration ") || this.raw.startsWith("<loop-iteration\n");
  }

  extensionMessage(): ExtensionMessage | null {
    const found = UserMessageText.EXTENSION_MESSAGE.exec(this.raw.trim());
    return found ? { from: found[1], body: found[2] } : null;
  }

  loopIteration(): LoopIteration | null {
    const open = this.raw.match(UserMessageText.LOOP_OPEN);
    if (!open) return null;
    const close = this.raw.lastIndexOf(UserMessageText.LOOP_CLOSE);
    if (close < 0) return null;
    const inner = this.raw.slice(open[0].length, close).trimEnd();
    const body = UserMessageText.LOOP_BOILERPLATE.reduce(
      (text, boilerplate) => text.replace(boilerplate, ""),
      inner,
    ).trim();
    return {
      index: Number(open[1]),
      total: open[2] ? Number(open[2]) : null,
      body,
    };
  }
}
