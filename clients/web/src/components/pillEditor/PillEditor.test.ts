// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { PillEditor } from "./PillEditor";

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

function editorShowing(value: string) {
  const root = document.createElement("div");
  root.contentEditable = "true";
  document.body.appendChild(root);
  const editor = new PillEditor(root);
  editor.show(value);
  return { root, editor };
}

/** Put the caret at `offset` inside `node`, as a click would. */
function caretAt(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("PillEditor caret offsets", () => {
  it("counts a pill as its whole @token and a line break as one character", () => {
    const { root, editor } = editorShowing("see @src/a.py\nnow");
    // Children: "see ", pill, <br>, "now".
    const tail = root.lastChild!;
    expect(tail.textContent).toBe("now");
    caretAt(tail, 1);
    expect(editor.caret()).toBe("see @src/a.py\n".length + 1);
  });

  it("reads a caret inside a pill as the pill's end", () => {
    const { root, editor } = editorShowing("x @lib/b.ts y");
    const pill = root.querySelector("[data-pill-path]")!;
    caretAt(pill.querySelector(".file-pill-name")!.firstChild!, 1);
    expect(editor.caret()).toBe("x @lib/b.ts".length);
  });

  it("reads 0 for a selection outside the editor", () => {
    const { editor } = editorShowing("hello");
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "outside";
    document.body.appendChild(elsewhere);
    caretAt(elsewhere.firstChild!, 3);
    expect(editor.caret()).toBe(0);
  });

  it("places the caret just after a pill when the offset falls on it", () => {
    const { root, editor } = editorShowing("a @p.md b");
    editor.placeCaret("a @p".length);
    const range = window.getSelection()!.getRangeAt(0);
    const pill = root.querySelector("[data-pill-path]")!;
    expect(range.startContainer).toBe(root);
    expect(root.childNodes[range.startOffset - 1]).toBe(pill);
  });

  it("round-trips every offset in plain text", () => {
    const { editor } = editorShowing("one\ntwo");
    for (const offset of [0, 2, 3, 4, 7]) {
      editor.placeCaret(offset);
      expect(editor.caret()).toBe(offset);
    }
  });

  it("puts an offset past the end at the end", () => {
    const { editor } = editorShowing("short");
    editor.placeCaret(99);
    expect(editor.caret()).toBe(5);
  });
});

describe("PillEditor reading what was typed", () => {
  it("turns a typed @token followed by a space into a pill, keeping the caret", () => {
    const { root, editor } = editorShowing("");
    root.appendChild(document.createTextNode("open @docs/x.md now"));
    caretAt(root.firstChild!, "open @docs/x.md ".length);
    root.focus();
    expect(editor.readTyped()).toBe("open @docs/x.md now");
    expect(root.querySelector("[data-pill-path]")?.getAttribute("data-pill-path")).toBe("docs/x.md");
    expect(editor.caret()).toBe("open @docs/x.md ".length);
  });

  it("leaves a token still being typed as text", () => {
    const { root, editor } = editorShowing("");
    root.appendChild(document.createTextNode("open @doc"));
    expect(editor.readTyped()).toBe("open @doc");
    // At the end of the text it is a pill already: the token ends at the edge.
    expect(root.querySelector("[data-pill-path]")).not.toBeNull();
    root.replaceChildren(document.createTextNode("mail a@b.com"));
    expect(editor.readTyped()).toBe("mail a@b.com");
    expect(root.querySelector("[data-pill-path]")).toBeNull();
  });

  it("reads a line the browser wrapped in a <div> as a new line", () => {
    const { root, editor } = editorShowing("");
    const line = document.createElement("div");
    line.textContent = "second";
    root.append(document.createTextNode("first"), line);
    expect(editor.value()).toBe("first\nsecond");
  });
});

describe("PillEditor deleting a pill", () => {
  it("removes the pill right before the caret as one unit", () => {
    const { root, editor } = editorShowing("a @p.md b");
    // The text node after the pill, at its start.
    const after = root.querySelector("[data-pill-path]")!.nextSibling!;
    caretAt(after, 0);
    expect(editor.deletePillBeforeCaret()).toBe(true);
    editor.mergeText();
    expect(editor.value()).toBe("a  b");
    expect(root.querySelector("[data-pill-path]")).toBeNull();
    expect(editor.caret()).toBe(2);
  });

  it("does nothing when the caret is not right after a pill", () => {
    const { root, editor } = editorShowing("a @p.md bc");
    const after = root.querySelector("[data-pill-path]")!.nextSibling!;
    caretAt(after, 2);
    expect(editor.deletePillBeforeCaret()).toBe(false);
    expect(editor.value()).toBe("a @p.md bc");
  });

  it("does nothing with a selection rather than a caret", () => {
    const { root, editor } = editorShowing("a @p.md b");
    const range = document.createRange();
    range.selectNodeContents(root);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(editor.deletePillBeforeCaret()).toBe(false);
  });
});

describe("PillEditor showing a value", () => {
  it("labels code pills from the labeler it was given since", () => {
    const { root, editor } = editorShowing("");
    editor.setLabels((id) => (id === "c1" ? "hello.py 9-11" : undefined));
    editor.show("see @code:c1 and @code:zz");
    const labels = [...root.querySelectorAll("[data-pill-code]")].map((el) => el.getAttribute("data-pill-label"));
    expect(labels).toEqual(["hello.py 9-11", "code"]);
    expect(editor.value()).toBe("see @code:c1 and @code:zz");
  });

  it("does not rebuild the DOM for a value it already shows", () => {
    const { root, editor } = editorShowing("keep @me");
    const pill = root.querySelector("[data-pill-path]");
    editor.show("keep @me");
    expect(root.querySelector("[data-pill-path]")).toBe(pill);
  });
});
