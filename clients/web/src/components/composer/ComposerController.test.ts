import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditableInputHandle } from "../EditableInput";
import { CodePillRegistry } from "./CodePillRegistry";
import type { CompletionMenu } from "./completionMenu";
import { ComposerController, type SentMessage } from "./ComposerController";
import { ComposerDraft } from "./composerDraft";
import { ComposerEditor } from "./ComposerEditor";
import { InputHistory } from "./InputHistory";
import type { CompletionMenuApi } from "./useCompletionMenu";
import type { ComposerDraftBinding } from "./useComposerDraft";

/** The window model's composer, in memory. `draft` is the render's, fixed
 *  at construction like a render's is. */
class MemoryBinding implements ComposerDraftBinding {
  readonly draft: ComposerDraft;

  constructor(public now: ComposerDraft) {
    this.draft = now;
  }

  current = (): ComposerDraft => this.now;

  write = (next: ComposerDraft): void => {
    this.now = next;
  };

  setText = (next: string | ((prev: string) => string)): void => {
    this.now = this.now.withText(typeof next === "function" ? next(this.now.text) : next);
  };
}

function build({
  text = "",
  mode = "chat",
  busy = false,
  menu = null,
  caret = text.length,
}: {
  text?: string;
  mode?: ComposerDraft["mode"];
  busy?: boolean;
  menu?: CompletionMenu | null;
  caret?: number;
} = {}) {
  const binding = new MemoryBinding(new ComposerDraft(text, mode));
  const handle: EditableInputHandle = {
    focus: vi.fn(),
    caret: () => caret,
    caretToEnd: vi.fn(),
    setCaretAt: vi.fn(),
    setValue: vi.fn(),
  };
  let history = InputHistory.empty();
  const completion: CompletionMenuApi = {
    menu,
    refresh: vi.fn(async () => {}),
    move: vi.fn(),
    close: vi.fn(),
    loadMore: vi.fn(async () => {}),
  };
  const onSent = vi.fn<(m: SentMessage) => void>();
  const onTyping = vi.fn<(wire: string) => void>();
  const controller = new ComposerController({
    binding,
    editor: new ComposerEditor({ current: handle }),
    history,
    setHistory: (update) => {
      history = typeof update === "function" ? update(history) : update;
    },
    registry: new CodePillRegistry(),
    completion,
    attachments: { busy },
    onTyping,
    onSent,
  });
  return { controller, binding, handle, completion, onSent, onTyping, history: () => history };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submit", () => {
  it("sends the trimmed wire form, remembers it, and empties the composer", () => {
    const { controller, binding, onSent, onTyping, completion, history } = build({
      text: "  help  ",
      mode: "command",
    });

    expect(controller.submit()).toEqual({ ok: true, text: "/help", droppedPills: [] });
    expect(onSent).toHaveBeenCalledExactlyOnceWith({ text: "/help", droppedPills: [] });
    expect(binding.now).toBe(ComposerDraft.EMPTY);
    expect(onTyping).toHaveBeenLastCalledWith("");
    expect(completion.close).toHaveBeenCalled();
    expect(history().prev("")?.entry).toBe("/help");
  });

  it("nothing but whitespace is empty, and nothing is sent", () => {
    const { controller, onSent } = build({ text: "  " });

    expect(controller.submit()).toEqual({ ok: false, reason: "empty" });
    expect(onSent).not.toHaveBeenCalled();
  });

  it("an upload in flight holds the message back", () => {
    const { controller, onSent, binding } = build({ text: "with file", busy: true });

    expect(controller.submit()).toEqual({ ok: false, reason: "uploading" });
    expect(onSent).not.toHaveBeenCalled();
    expect(binding.now.text).toBe("with file");
  });

  it("names the code pills it had to drop", () => {
    const { controller } = build({ text: "see @code:c1" });

    const outcome = controller.submit();

    expect(outcome.ok && outcome.droppedPills).toEqual(["c1"]);
  });

  it.each([
    ["", false],
    ["  ", false],
    ["hi", false],
    ["", true],
    ["hi", true],
  ])("canSend agrees with submit for %j (uploading: %s)", (text, busy) => {
    const { controller } = build({ text, busy });
    const canSend = controller.canSend;

    expect(controller.submit().ok).toBe(canSend);
  });
});

describe("applyChoice", () => {
  it("splices a file into the @ token under the caret and closes the menu", () => {
    const menu: CompletionMenu = {
      kind: "mention",
      entries: [],
      active: 0,
      tokenStart: 4,
      total: 0,
      limit: 0,
      query: "sr",
    };
    const { controller, binding, completion, handle } = build({ text: "see @sr more", menu, caret: 7 });

    controller.applyChoice({ key: "src/a.ts", label: "a.ts" });

    expect(binding.now.text).toBe("see @src/a.ts  more");
    expect(completion.close).toHaveBeenCalled();
    expect(handle.focus).toHaveBeenCalled();
  });

  it("does nothing with no menu open", () => {
    const { controller, binding } = build({ text: "hi" });

    controller.applyChoice({ key: "/help", label: "/help" });

    expect(binding.now.text).toBe("hi");
  });
});

describe("landMention", () => {
  it("appends the landed path to the draft as it is now", () => {
    const { controller, binding, handle } = build({ text: "old" });
    binding.write(new ComposerDraft("newer", "chat"));

    controller.landMention("att/a.png");

    expect(binding.now.text).toBe("newer @att/a.png ");
    expect(handle.caretToEnd).toHaveBeenCalled();
  });
});

describe("changeValue", () => {
  it("a typed / enters command mode and re-syncs the editor", () => {
    const { controller, binding, handle, onTyping, completion } = build();

    controller.changeValue("/", 1);

    expect(binding.now).toEqual(new ComposerDraft("", "command"));
    expect(handle.setValue).toHaveBeenCalledWith("");
    expect(onTyping).toHaveBeenLastCalledWith("/");
    expect(completion.refresh).toHaveBeenCalledWith("/", 1);
  });
});

describe("recall", () => {
  it("puts a history entry in the composer, in its mode", () => {
    const { controller, binding } = build();

    controller.recall({ history: InputHistory.empty(), entry: "$ ls" });

    expect(binding.now).toEqual(new ComposerDraft("ls", "shell"));
  });
});
