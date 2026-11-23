/**
 * Tests for classifying a file from its name.
 *
 * The read matters because the viewer decodes UTF-8 with replacement, so
 * the classifier — not an error — is what keeps a PDF or an image off the
 * source pane, and ``looksBinary`` is the backstop for a binary file
 * wearing an innocent extension.
 */

import { describe, expect, it } from "vitest";

import { classify, isReadable, kindLabel, looksBinary } from "./fileKind";

describe("classify", () => {
  it("names markdown, image, pdf and binary by extension", () => {
    expect(classify("docs/README.md")).toBe("markdown");
    expect(classify("a/logo.PNG")).toBe("image");
    expect(classify("a/report.pdf")).toBe("pdf");
    expect(classify("a/bundle.zip")).toBe("binary");
    expect(classify("a/font.woff2")).toBe("binary");
  });

  it("treats code and unknown extensions as text", () => {
    expect(classify("src/app.ts")).toBe("text");
    expect(classify("Makefile")).toBe("text");
    expect(classify("a/data.weirdext")).toBe("text");
    expect(classify("")).toBe("text");
  });
});

describe("isReadable", () => {
  it("is true only for the kinds the text read can show", () => {
    expect(isReadable(classify("a.md"))).toBe(true);
    expect(isReadable(classify("a.ts"))).toBe(true);
    expect(isReadable(classify("a.pdf"))).toBe(false);
    expect(isReadable(classify("a.png"))).toBe(false);
  });
});

describe("looksBinary", () => {
  it("catches a NUL byte that no real source carries", () => {
    expect(looksBinary("plain text\nmore")).toBe(false);
    expect(looksBinary("PK\u0003\u0004\u0000garbage")).toBe(true);
  });
});

describe("kindLabel", () => {
  it("reads naturally in the card", () => {
    expect(kindLabel("pdf")).toBe("PDF");
    expect(kindLabel("image")).toBe("image");
    expect(kindLabel("binary")).toBe("binary");
  });
});
