/**
 * ``guessLang`` maps a file extension to a highlight.js language. A
 * wrong mapping is wrong colouring in a snippet preview.
 */

import { describe, expect, it } from "vitest";
import { guessLang } from "./hljsLanguage";

describe("guessLang", () => {
  it("returns empty for an extension we don't know", () => {
    // Highlight.js falls back to plain text on empty lang —
    // safer than guessing wrong (highlighter mangles output
    // when given the wrong grammar).
    expect(guessLang("file.unknown")).toBe("");
    expect(guessLang("README")).toBe(""); // no extension at all
  });

  it("normalizes Python extensions", () => {
    expect(guessLang("foo.py")).toBe("python");
    expect(guessLang("types.pyi")).toBe("python");
  });

  it("disambiguates TypeScript from JSX flavor", () => {
    // ``.tsx`` must NOT collapse to "typescript" — highlight.js
    // mishandles the JSX tags.
    expect(guessLang("Button.tsx")).toBe("tsx");
    expect(guessLang("util.ts")).toBe("typescript");
    expect(guessLang("legacy.jsx")).toBe("jsx");
    expect(guessLang("util.js")).toBe("javascript");
  });

  it("maps shell aliases to 'bash'", () => {
    // ``.zsh`` / ``.bash`` files have no separate highlighter
    // — they all render under "bash".
    expect(guessLang("install.sh")).toBe("bash");
    expect(guessLang(".zshrc.zsh")).toBe("bash");
  });

  it("maps both yaml extensions", () => {
    expect(guessLang("config.yml")).toBe("yaml");
    expect(guessLang("config.yaml")).toBe("yaml");
  });

  it("maps html/xml to xml grammar", () => {
    // The xml highlighter handles both; highlight.js has no
    // separate html mode in the slim bundle we ship.
    expect(guessLang("index.html")).toBe("xml");
    expect(guessLang("doc.xml")).toBe("xml");
  });

  it("is case-insensitive on the extension", () => {
    // Some uploads from Finder carry the original
    // ``Document.PY``-style capitalisation; we shouldn't drop
    // syntax highlighting for that.
    expect(guessLang("Foo.PY")).toBe("python");
    expect(guessLang("Bar.TS")).toBe("typescript");
  });

  it("uses the last dot for the extension", () => {
    // ``foo.test.ts`` → ts, not test. (split(".").pop())
    expect(guessLang("foo.test.ts")).toBe("typescript");
    expect(guessLang("multi.part.name.py")).toBe("python");
  });

  it("handles a path with directory components", () => {
    expect(guessLang("src/lib/host.ts")).toBe("typescript");
    expect(guessLang("/abs/path/file.rs")).toBe("rust");
  });
});
