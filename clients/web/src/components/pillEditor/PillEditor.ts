import { type CodePillLabeler, noLabels, Pills } from "./pills";

interface DomPoint {
  node: Node;
  offset: number;
}

function childIndex(node: Node): number {
  let i = 0;
  for (let n = node.previousSibling; n; n = n.previousSibling) i++;
  return i;
}

/** The editor root of the composer's contenteditable, kept in step with
 *  a canonical string: plain text with literal `@<path>` tokens, which
 *  the DOM shows as non-editable pills and `<br>` line breaks.
 *
 *  Offsets ("caret") are always in canonical-string space, where a pill
 *  counts as its whole `@<token>` and a `<br>` as one character. */
export class PillEditor {
  private pills: Pills = new Pills(noLabels);

  constructor(private readonly root: HTMLElement) {}

  /** Where code pills built from now on get their labels. */
  setLabels(labelOf: CodePillLabeler): void {
    this.pills = new Pills(labelOf);
  }

  /** Walk the DOM and rebuild the canonical string. */
  value(): string {
    let out = "";
    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent || "";
        return;
      }
      if (!(node instanceof Element)) return;
      const tok = Pills.tokenOf(node);
      if (tok !== null) {
        out += tok;
        return;
      }
      if (node.tagName === "BR") {
        out += "\n";
        return;
      }
      // Browsers wrap new lines in <div> on Enter.
      if (node.tagName === "DIV" && out.length && !out.endsWith("\n")) out += "\n";
      node.childNodes.forEach(walk);
    };
    this.root.childNodes.forEach(walk);
    return out;
  }

  /** Caret offset of the current selection; 0 when it is elsewhere. */
  caret(): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    if (!this.root.contains(range.endContainer)) return 0;

    let offset = 0;
    let found = false;
    const walk = (node: Node): void => {
      if (found) return;
      if (node.nodeType === Node.TEXT_NODE) {
        if (node === range.endContainer) {
          offset += range.endOffset;
          found = true;
        } else {
          offset += (node.textContent || "").length;
        }
        return;
      }
      if (!(node instanceof Element)) return;
      const tok = Pills.tokenOf(node);
      if (tok !== null) {
        offset += tok.length;
        // A selection landing inside the pill counts as its end.
        if (node.contains(range.endContainer)) found = true;
        return;
      }
      if (node.tagName === "BR") {
        offset += 1;
        return;
      }
      for (const child of Array.from(node.childNodes)) {
        walk(child);
        if (found) return;
      }
    };
    for (const child of Array.from(this.root.childNodes)) {
      walk(child);
      if (found) break;
    }
    return offset;
  }

  /** Place the caret at a canonical offset. */
  placeCaret(target: number): void {
    const point = this.pointAt(target) ?? { node: this.root, offset: this.root.childNodes.length };
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    this.select(range);
  }

  caretToEnd(): void {
    const range = document.createRange();
    range.selectNodeContents(this.root);
    range.collapse(false);
    this.select(range);
  }

  /** Make the DOM show `value`, keeping a focused caret where it was
   *  (clamped to the new length). A no-op when it already does. */
  show(value: string): void {
    if (this.value() === value) return;
    const caret = document.activeElement === this.root ? this.caret() : null;
    this.render(value);
    if (caret !== null) this.placeCaret(Math.min(caret, value.length));
  }

  /** Read what the user typed, first turning any `@<token>` the browser
   *  left as plain text into a pill. */
  readTyped(): string {
    const next = this.value();
    // Plain typing fast path: with no `@` no pill can be needed, so skip
    // the regex, the scratch render and the markup compare.
    if (next.includes("@") && Pills.PATTERN.test(next)) {
      const caret = this.caret();
      if (this.root.innerHTML !== this.htmlFor(next)) {
        this.render(next);
        this.placeCaret(Math.min(caret, next.length));
      }
    }
    return next;
  }

  /** Delete the pill directly before a collapsed caret as one unit,
   *  leaving the caret where it started. False when there is none. */
  deletePillBeforeCaret(): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
    const pill = this.pillBefore(sel.getRangeAt(0));
    if (!pill) return false;
    const range = document.createRange();
    range.setStartBefore(pill);
    range.collapse(true);
    pill.remove();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  /** Merge adjacent text nodes, so a deletion leaves no split text
   *  behind to trip later caret math. */
  mergeText(): void {
    this.root.normalize();
  }

  /** The caret is "right after" a pill in two DOM shapes: the root at
   *  offset N with child N-1 a pill, or offset 0 of a text node of the
   *  root whose previous sibling is a pill. */
  private pillBefore(r: Range): Element | null {
    let candidate: Node | null = null;
    if (r.startContainer === this.root) {
      candidate = this.root.childNodes[r.startOffset - 1] ?? null;
    } else if (
      r.startContainer.nodeType === Node.TEXT_NODE &&
      r.startOffset === 0 &&
      r.startContainer.parentNode === this.root
    ) {
      candidate = r.startContainer.previousSibling;
    }
    return candidate instanceof Element && Pills.tokenOf(candidate) !== null ? candidate : null;
  }

  private pointAt(target: number): DomPoint | null {
    let remaining = target;
    const dive = (node: Node): DomPoint | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        const len = (node.textContent || "").length;
        if (remaining <= len) return { node, offset: remaining };
        remaining -= len;
        return null;
      }
      if (!(node instanceof Element)) return null;
      const tok = Pills.tokenOf(node);
      if (tok !== null) {
        // Stand just after the pill, at the parent's boundary.
        if (remaining <= tok.length) return { node: node.parentNode!, offset: childIndex(node) + 1 };
        remaining -= tok.length;
        return null;
      }
      if (node.tagName === "BR") {
        if (remaining < 1) return { node: node.parentNode!, offset: childIndex(node) };
        remaining -= 1;
        return null;
      }
      for (const child of Array.from(node.childNodes)) {
        const hit = dive(child);
        if (hit) return hit;
      }
      return null;
    };
    return dive(this.root);
  }

  private select(range: Range): void {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  /** Replace the DOM with `value`, touching the live tree once. */
  private render(value: string): void {
    this.root.replaceChildren(this.fragmentFor(value));
  }

  /** The markup `value` renders to, for deciding whether a rebuild is
   *  needed. */
  private htmlFor(value: string): string {
    const scratch = document.createElement("div");
    scratch.appendChild(this.fragmentFor(value));
    return scratch.innerHTML;
  }

  private fragmentFor(value: string): DocumentFragment {
    const frag = document.createDocumentFragment();
    let rest = value;
    while (rest.length) {
      const m = rest.match(Pills.PATTERN);
      if (!m || m.index === undefined) {
        this.appendText(frag, rest);
        break;
      }
      if (m.index > 0) this.appendText(frag, rest.slice(0, m.index));
      frag.appendChild(this.pills.build(m[1]));
      rest = rest.slice(m.index + m[0].length);
    }
    return frag;
  }

  private appendText(parent: Node, text: string): void {
    const parts = text.split("\n");
    parts.forEach((p, i) => {
      if (p) parent.appendChild(document.createTextNode(p));
      if (i < parts.length - 1) parent.appendChild(document.createElement("br"));
    });
  }
}
