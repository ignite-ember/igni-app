import { describe, expect, it } from "vitest";

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
});
