/**
 * A path's highlight.js language, from the languages in highlight.js's
 * "common" bundle. Anything else is plain text: readable, not coloured.
 */

const EXT_TO_HLJS_LANG: ReadonlyMap<string, string> = new Map([
  ["py", "python"],
  ["pyi", "python"],
  ["ts", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["jsx", "jsx"],
  ["json", "json"],
  ["rs", "rust"],
  ["go", "go"],
  ["java", "java"],
  ["kt", "kotlin"],
  ["rb", "ruby"],
  ["sh", "bash"],
  ["bash", "bash"],
  ["zsh", "bash"],
  ["yml", "yaml"],
  ["yaml", "yaml"],
  ["toml", "toml"],
  ["md", "markdown"],
  ["html", "xml"],
  ["xml", "xml"],
  ["css", "css"],
  ["sql", "sql"],
  ["c", "c"],
  ["h", "c"],
  ["cpp", "cpp"],
  ["hpp", "cpp"],
  ["swift", "swift"],
]);

export function guessLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_HLJS_LANG.get(ext) ?? "";
}
