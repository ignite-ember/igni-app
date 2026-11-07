/** The two inline glyphs a pill can carry, built as DOM nodes rather
 *  than markup strings. They are drawn without React so the editor can
 *  mutate its contenteditable DOM directly, at the same visual budget
 *  as `FileTypeIcon`. */

const SVG_NS = "http://www.w3.org/2000/svg";

interface GlyphShape {
  readonly tag: "path" | "line";
  readonly attrs: Readonly<Record<string, string>>;
}

const STROKE_ROUND = {
  stroke: "currentColor",
  "stroke-width": "1.4",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  fill: "none",
} as const;

const FILE_OUTLINE =
  "M3.5 1.5h6L13 5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2 13V3a1.5 1.5 0 0 1 1.5-1.5z";

/** A page with a folded corner and three text lines. */
const FILE_GLYPH: readonly GlyphShape[] = [
  { tag: "path", attrs: { d: FILE_OUTLINE, fill: "currentColor", opacity: "0.2" } },
  { tag: "path", attrs: { d: FILE_OUTLINE, stroke: "currentColor", "stroke-width": "1", fill: "none" } },
  { tag: "path", attrs: { d: "M9.5 1.5V5H13", stroke: "currentColor", "stroke-width": "1", fill: "none" } },
  { tag: "line", attrs: { x1: "4", y1: "9", x2: "11", y2: "9", stroke: "currentColor", "stroke-width": "0.9" } },
  { tag: "line", attrs: { x1: "4", y1: "10.6", x2: "11", y2: "10.6", stroke: "currentColor", "stroke-width": "0.9" } },
  { tag: "line", attrs: { x1: "4", y1: "12.2", x2: "9", y2: "12.2", stroke: "currentColor", "stroke-width": "0.9" } },
];

/** Two brackets: visually distinct from the file glyph so a snippet
 *  pill never reads as a path. */
const CODE_GLYPH: readonly GlyphShape[] = [
  { tag: "path", attrs: { d: "M5.5 4L2.5 8L5.5 12", ...STROKE_ROUND } },
  { tag: "path", attrs: { d: "M10.5 4L13.5 8L10.5 12", ...STROKE_ROUND } },
];

function buildGlyph(shapes: readonly GlyphShape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("style", "display:block;flex-shrink:0");
  for (const shape of shapes) {
    const el = document.createElementNS(SVG_NS, shape.tag);
    for (const [name, value] of Object.entries(shape.attrs)) el.setAttribute(name, value);
    svg.appendChild(el);
  }
  return svg;
}

export function fileGlyph(): SVGSVGElement {
  return buildGlyph(FILE_GLYPH);
}

export function codeGlyph(): SVGSVGElement {
  return buildGlyph(CODE_GLYPH);
}
