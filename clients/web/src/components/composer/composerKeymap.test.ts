import { describe, expect, it, vi } from "vitest";

import type { CompletionMenu } from "./completionMenu";
import { ComposerDraft } from "./composerDraft";
import { ComposerKeymap, type KeymapContext } from "./composerKeymap";
import { InputHistory } from "./InputHistory";

/** A keydown as React hands it to the editor, recording what it was told. */
function key(name: string, mods: { shiftKey?: boolean } = {}) {
  return {
    key: name,
    shiftKey: mods.shiftKey ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

const slashMenu: CompletionMenu = {
  kind: "slash",
  entries: [
    { key: "/help", label: "/help" },
    { key: "/help-more", label: "/help-more" },
  ],
  active: 0,
  tokenStart: 0,
};

function context(over: Partial<KeymapContext> = {}): KeymapContext {
  const draft = over.draft ?? ComposerDraft.EMPTY;
  return {
    menu: null,
    moveMenu: vi.fn(),
    closeMenu: vi.fn(),
    applyChoice: vi.fn(),
    draft,
    currentDraft: () => draft,
    history: InputHistory.empty(),
    recall: vi.fn(),
    submit: vi.fn(),
    exitToChat: vi.fn(),
    ...over,
  };
}

function press(ctx: KeymapContext, name: string, mods?: { shiftKey?: boolean }) {
  const e = key(name, mods);
  new ComposerKeymap(ctx).handle(e as never);
  return e;
}

describe("ComposerKeymap: with the completion menu open", () => {
  it("moves the highlight with the arrows instead of recalling history", () => {
    const ctx = context({ menu: slashMenu, history: InputHistory.empty().push("older") });
    expect(press(ctx, "ArrowDown").preventDefault).toHaveBeenCalled();
    press(ctx, "ArrowUp");
    expect(ctx.moveMenu).toHaveBeenNthCalledWith(1, 1);
    expect(ctx.moveMenu).toHaveBeenNthCalledWith(2, -1);
    expect(ctx.recall).not.toHaveBeenCalled();
  });

  it("accepts the highlighted entry with Tab or Enter", () => {
    const ctx = context({ menu: slashMenu, draft: new ComposerDraft("he", "command") });
    press(ctx, "Tab");
    press(ctx, "Enter");
    expect(ctx.applyChoice).toHaveBeenCalledTimes(2);
    expect(ctx.applyChoice).toHaveBeenCalledWith(slashMenu.entries[0]);
    expect(ctx.submit).not.toHaveBeenCalled();
  });

  it("runs a command already typed in full with one Enter", () => {
    const ctx = context({ menu: slashMenu, draft: new ComposerDraft("help ", "command") });
    press(ctx, "Enter");
    expect(ctx.closeMenu).toHaveBeenCalled();
    expect(ctx.submit).toHaveBeenCalled();
    expect(ctx.applyChoice).not.toHaveBeenCalled();
  });

  it("closes the menu on Escape and keeps the key from cancelling the run", () => {
    const ctx = context({ menu: slashMenu });
    const e = press(ctx, "Escape");
    expect(ctx.closeMenu).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(ctx.exitToChat).not.toHaveBeenCalled();
  });
});

describe("ComposerKeymap: Escape and Backspace", () => {
  it("leaves command or shell mode on Escape", () => {
    const ctx = context({ draft: new ComposerDraft("lo", "shell") });
    const e = press(ctx, "Escape");
    expect(ctx.exitToChat).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it("lets Escape through to the app (cancel the run) in a plain chat draft", () => {
    const ctx = context({ draft: new ComposerDraft("hello", "chat") });
    const e = press(ctx, "Escape");
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves the mode on the Backspace that would empty it", () => {
    const ctx = context({ draft: new ComposerDraft("h", "command") });
    const e = press(ctx, "Backspace");
    expect(ctx.exitToChat).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("reads the latest draft, so a burst of Backspaces exits on the right press", () => {
    // The render still shows "ab"; the model already holds "b".
    const ctx = context({
      draft: new ComposerDraft("ab", "command"),
      currentDraft: () => new ComposerDraft("b", "command"),
    });
    press(ctx, "Backspace");
    expect(ctx.exitToChat).toHaveBeenCalled();
  });

  it("deletes a character normally with more text left, and in chat mode", () => {
    const typo = context({ draft: new ComposerDraft("lis", "command") });
    expect(press(typo, "Backspace").preventDefault).not.toHaveBeenCalled();
    expect(typo.exitToChat).not.toHaveBeenCalled();
    const chat = context({ draft: new ComposerDraft("", "chat") });
    press(chat, "Backspace");
    expect(chat.exitToChat).not.toHaveBeenCalled();
  });
});

describe("ComposerKeymap: history and sending", () => {
  it("recalls the newest sent message on ArrowUp, keeping the draft in wire form", () => {
    const history = InputHistory.empty().push("/help").push("$ ls");
    const ctx = context({ draft: new ComposerDraft("half", "chat"), history });
    expect(press(ctx, "ArrowUp").preventDefault).toHaveBeenCalled();
    const step = vi.mocked(ctx.recall).mock.calls[0][0];
    expect(step.entry).toBe("$ ls");
    // Walking back past the newest entry gives the draft back.
    expect(step.history.next()?.entry).toBe("half");
  });

  it("leaves ArrowUp to the editor in a multi-line draft or with nothing sent", () => {
    const multi = context({ draft: new ComposerDraft("a\nb", "chat"), history: InputHistory.empty().push("x") });
    expect(press(multi, "ArrowUp").preventDefault).not.toHaveBeenCalled();
    const empty = context();
    expect(press(empty, "ArrowUp").preventDefault).not.toHaveBeenCalled();
    expect(empty.recall).not.toHaveBeenCalled();
  });

  it("leaves ArrowDown to the editor when not browsing history", () => {
    const ctx = context({ history: InputHistory.empty().push("x") });
    expect(press(ctx, "ArrowDown").preventDefault).not.toHaveBeenCalled();
    expect(ctx.recall).not.toHaveBeenCalled();
  });

  it("sends on Enter, and leaves Shift+Enter as a newline", () => {
    const ctx = context({ draft: new ComposerDraft("hi", "chat") });
    expect(press(ctx, "Enter").preventDefault).toHaveBeenCalled();
    expect(ctx.submit).toHaveBeenCalledTimes(1);
    expect(press(ctx, "Enter", { shiftKey: true }).preventDefault).not.toHaveBeenCalled();
    expect(ctx.submit).toHaveBeenCalledTimes(1);
  });
});
