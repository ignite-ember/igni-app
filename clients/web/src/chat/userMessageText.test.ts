import { describe, expect, it } from "vitest";
import { ChatItemFactory } from "./chatItemFactory";
import { ChatItemIds } from "./chatItemIds";
import { UserMessageText } from "./userMessageText";

const parseLoopIteration = (wrapped: string) => new UserMessageText(wrapped).loopIteration();

describe("UserMessageText#loopIteration", () => {
  const wrapped = (idx: number, total: number | null, body: string) =>
    `<loop-iteration index="${idx}"${total ? ` total="${total}"` : ""}>\n` +
    `Autonomous loop iteration — do not ask the user; perform one unit of work and stop. ` +
    `Tool-permission prompts are the only legitimate user interaction.\n\n` +
    `When you can determine the total number of items (e.g. after listing files or parsing the input), ` +
    `call loop_set_total(N) once so the panel renders progress as N/total. ` +
    `Call loop_stop() when all work is done — don't keep looping just because the safety cap hasn't been hit.\n\n` +
    `${body}\n` +
    `</loop-iteration>`;

  it("extracts iteration index, total, and the original ask", () => {
    const parsed = parseLoopIteration(
      wrapped(2, 45, "Through each president of the USA and sum all their dates of birth. Do it one by one"),
    );
    expect(parsed).toEqual({
      index: 2,
      total: 45,
      body:
        "Through each president of the USA and sum all their dates of birth. Do it one by one",
    });
  });

  it("returns total null when the BE omits the attribute", () => {
    const parsed = parseLoopIteration(wrapped(1, null, "do thing X"));
    expect(parsed?.total).toBeNull();
    expect(parsed?.body).toBe("do thing X");
  });

  it("preserves blank lines inside the user's prompt", () => {
    const body = "Step 1: list files\n\nStep 2: summarize each";
    const parsed = parseLoopIteration(wrapped(3, 10, body));
    expect(parsed?.body).toBe(body);
  });

  it("returns null when the wrapper is missing", () => {
    expect(parseLoopIteration("just plain text")).toBeNull();
  });

  it("ChatItemFactory#loop builds a structured chat item; falls back to info on bad input", () => {
    const factory = new ChatItemFactory(new ChatItemIds());
    const ok = factory.loop(wrapped(7, 12, "the ask"));
    expect(ok.kind).toBe("loop");
    if (ok.kind === "loop") {
      expect(ok.index).toBe(7);
      expect(ok.total).toBe(12);
      expect(ok.body).toBe("the ask");
    }
    const bad = factory.loop("not a loop wrapper");
    expect(bad).toMatchObject({ kind: "info", text: "↻ loop: not a loop wrapper" });
  });
});

describe("UserMessageText#visible", () => {
  it("strips injected system-context and the attached-files hint", () => {
    const raw =
      "<system-context>Now: 14:42</system-context>\n" +
      "<attached-files>\n[Referenced files: a.py — read before responding]\n</attached-files>\n" +
      "the prompt";
    expect(new UserMessageText(raw).visible()).toBe("the prompt");
  });

  it("is stable across repeated calls (no regex state carried between them)", () => {
    const text = new UserMessageText("<system-context>x</system-context>hi");
    expect(text.visible()).toBe("hi");
    expect(text.visible()).toBe("hi");
  });
});

describe("UserMessageText#extensionMessage", () => {
  it("unwraps a message an extension posted", () => {
    const text = new UserMessageText('<extension-message from="acme.x">\nbody\n</extension-message>');
    expect(text.extensionMessage()).toEqual({ from: "acme.x", body: "body" });
  });

  it("is null for a person's own message", () => {
    expect(new UserMessageText("hello").extensionMessage()).toBeNull();
  });
});

describe("UserMessageText.stripThinkBlocks", () => {
  it("strips closed blocks and a trailing unclosed one", () => {
    expect(UserMessageText.stripThinkBlocks("<think>a</think>\nDone.")).toBe("Done.");
    expect(UserMessageText.stripThinkBlocks("Partial.\n<think>still")).toBe("Partial.");
  });
});

describe("UserMessageText#mode", () => {
  it("reads a leading slash as a command and a leading $ as shell", () => {
    expect(new UserMessageText("/plan on").mode()).toBe("command");
    expect(new UserMessageText("$ ls -la").mode()).toBe("shell");
    expect(new UserMessageText("hello").mode()).toBe("chat");
  });

  it("classifies after the leading wrappers", () => {
    const raw =
      "<system-context>Now: 14:42</system-context>\n" +
      "<attached-files>\na.py\n</attached-files>\n" +
      "/compact";
    expect(new UserMessageText(raw).mode()).toBe("command");
  });

  it("does not trim, so indented text is chat", () => {
    expect(new UserMessageText("  /foo").mode()).toBe("chat");
    expect(new UserMessageText("\n$ ls").mode()).toBe("chat");
  });

  it("only strips a wrapper at the very start", () => {
    // ``visible()`` strips wrappers anywhere; the classifier does not.
    expect(new UserMessageText("x<system-context>c</system-context>/foo").mode()).toBe("chat");
  });
});
