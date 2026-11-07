import { describe, expect, it } from "vitest";

import type { MentionMenu, SlashMenu } from "./completionMenu";
import { ComposerDraft } from "./composerDraft";

describe("ComposerDraft", () => {
  it.each([
    ["/help", "help", "command"],
    ["$ ls -la", "ls -la", "shell"],
    ["hello", "hello", "chat"],
  ] as const)("%s round-trips through its mode", (wire, text, mode) => {
    const draft = ComposerDraft.fromWire(wire);

    expect([draft.text, draft.mode]).toEqual([text, mode]);
    expect(draft.toWire()).toBe(wire);
  });

  it("reading a shell entry drops all the spaces after $", () => {
    expect(ComposerDraft.fromWire("$   ls").text).toBe("ls");
  });

  it("is the model's composer without attachments", () => {
    expect(new ComposerDraft("x", "shell").toModel()).toEqual({
      text: "x",
      mode: "shell",
      attachments: [],
    });
  });

  describe("fromTyped", () => {
    it("a typed / or $ enters its mode with the character consumed", () => {
      expect(ComposerDraft.fromTyped("/")).toEqual(new ComposerDraft("", "command"));
      expect(ComposerDraft.fromTyped("$ls")).toEqual(new ComposerDraft("ls", "shell"));
    });

    it("eats one space after the trigger, not more", () => {
      expect(ComposerDraft.fromTyped("$  ls")!.text).toBe(" ls");
    });

    it("anything else is not a trigger", () => {
      expect(ComposerDraft.fromTyped("hi /there")).toBeNull();
    });
  });

  describe("what the menu is asked about", () => {
    it("while typing a command, the / is put back and the caret moved past it", () => {
      expect(new ComposerDraft("he", "command").menuProbe(2)).toEqual({ value: "/he", caret: 3 });
    });

    it("while typing a shell line, the text is probed as is", () => {
      expect(new ComposerDraft("@a", "shell").menuProbe(2)).toEqual({ value: "@a", caret: 2 });
    });

    it("on the trigger keystroke, the wire form is probed with the caret past the prefix", () => {
      expect(new ComposerDraft("", "command").triggerProbe(0)).toEqual({ value: "/", caret: 1 });
      expect(new ComposerDraft("ls", "shell").triggerProbe(3)).toEqual({ value: "$ ls", caret: 3 });
    });
  });

  describe("sendable", () => {
    it.each([
      ["", false],
      ["  \n ", false],
      [" hi ", true],
    ] as const)("%j is sendable: %s", (text, sendable) => {
      expect(new ComposerDraft(text, "chat").sendable).toBe(sendable);
    });
  });

  describe("withMentionAppended", () => {
    it.each([
      ["", "@a.png "],
      ["see ", "see @a.png "],
      ["see\n", "see\n@a.png "],
      ["see", "see @a.png "],
    ])("%j becomes %j", (text, joined) => {
      expect(new ComposerDraft(text, "shell").withMentionAppended("a.png")).toEqual(
        new ComposerDraft(joined, "shell"),
      );
    });
  });

  it("withInsertedAt puts the snippet at the offset", () => {
    expect(new ComposerDraft("ab", "chat").withInsertedAt(1, "XY").text).toBe("aXYb");
  });

  describe("withCompletion", () => {
    const slash: SlashMenu = { kind: "slash", entries: [], active: 0, tokenStart: 0 };
    const entry = { key: "/help", label: "/help" };

    it("a command in chat mode replaces the draft with the command", () => {
      expect(new ComposerDraft("/he", "chat").withCompletion(slash, entry, 3)).toEqual(
        new ComposerDraft("/help ", "chat"),
      );
    });

    it("a command in command mode leaves the / to the badge", () => {
      expect(new ComposerDraft("he", "command").withCompletion(slash, entry, 2)).toEqual(
        new ComposerDraft("help ", "command"),
      );
    });

    it("a file replaces the @ token up to the caret and keeps what follows", () => {
      const mention: MentionMenu = {
        kind: "mention",
        entries: [],
        active: 0,
        tokenStart: 4,
        total: 0,
        limit: 0,
        query: "sr",
      };
      const draft = new ComposerDraft("see @sr more", "chat");

      expect(draft.withCompletion(mention, { key: "src/a.ts", label: "a.ts" }, 7).text).toBe(
        "see @src/a.ts  more",
      );
    });
  });
});
