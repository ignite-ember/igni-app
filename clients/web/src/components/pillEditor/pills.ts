import { codeGlyph, fileGlyph } from "./pillGlyphs";

/** Looks up a code pill's display label (e.g. "hello.py 9-11") by its
 *  id; `undefined` for an id it does not know. */
export type CodePillLabeler = (id: string) => string | undefined;

export const noLabels: CodePillLabeler = () => undefined;

const PILL_ATTR = "data-pill-path";
const CODE_PILL_ATTR = "data-pill-code";
const CODE_PILL_LABEL_ATTR = "data-pill-label";
const CODE_PILL_PREFIX = "code:";

/** The inline `@<token>` pills of the editor: how a token is written as
 *  a non-editable `<span>`, and how such a span reads back as a token.
 *
 *  "@/abs/path", "@./rel", "@bare", "@code:abc123": token characters are
 *  non-whitespace, and a token only counts when whitespace (or the edge
 *  of the text) is on both sides. A `code:` prefix marks a pasted
 *  snippet rather than a path. */
export class Pills {
  static readonly PATTERN = /(?:^|(?<=\s))@(\S+)(?=\s|$)/;

  constructor(private readonly labelOf: CodePillLabeler) {}

  /** The canonical `@<token>` for a pill node; `null` for anything that
   *  is not a pill. */
  static tokenOf(node: Node | null | undefined): string | null {
    if (!(node instanceof Element)) return null;
    const path = node.getAttribute(PILL_ATTR);
    if (path !== null) return `@${path}`;
    const code = node.getAttribute(CODE_PILL_ATTR);
    if (code !== null) return `@${CODE_PILL_PREFIX}${code}`;
    return null;
  }

  /** The pill for a matched token, without its leading `@`. */
  build(token: string): HTMLSpanElement {
    return token.startsWith(CODE_PILL_PREFIX)
      ? this.codePill(token.slice(CODE_PILL_PREFIX.length))
      : this.filePill(token);
  }

  /** A file pill shows the basename and keeps the whole path. */
  private filePill(path: string): HTMLSpanElement {
    const span = this.shell("file-pill inline-pill", fileGlyph(), path.split("/").pop() || path);
    span.setAttribute(PILL_ATTR, path);
    span.title = path;
    return span;
  }

  /** A code pill's id is the opaque token in the canonical text; its
   *  label is also stored on the node, so a re-render from the DOM
   *  keeps it. */
  private codePill(id: string): HTMLSpanElement {
    const label = this.labelOf(id) || "code";
    const span = this.shell("file-pill code-pill inline-pill", codeGlyph(), label);
    span.setAttribute(CODE_PILL_ATTR, id);
    span.setAttribute(CODE_PILL_LABEL_ATTR, label);
    span.title = label;
    return span;
  }

  /** Same look as the .file-pill in a user bubble: icon + name. */
  private shell(className: string, glyph: SVGSVGElement, name: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = className;
    span.setAttribute("contenteditable", "false");
    const icon = document.createElement("span");
    icon.className = "file-pill-icon";
    icon.appendChild(glyph);
    const label = document.createElement("span");
    label.className = "file-pill-name";
    label.textContent = name;
    span.append(icon, label);
    return span;
  }
}
