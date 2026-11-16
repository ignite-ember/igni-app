// @vitest-environment node
/**
 * The desktop loading page's progress bar is driven by the shell's status
 * strings: `public/loading.html` matches each `igni-bootstrap-progress`
 * message against its `STAGES` patterns, in order. The two live in
 * different languages and drifted: after the rename the page still looked
 * for "ignite-ember" and an "embedding model", so the bar sat at step 4 of
 * 7 through the igni-core install and the 1.7 GB decision-model download,
 * and the "~250 MB" hint never went away. Found by the desktop E2E's
 * first-launch screenshots (docs/ENTERPRISE_TEST_PLAN.md PLAT-001).
 *
 * This reads the page's table and the Rust sources and checks every
 * message the shell sends lands on its stage.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, "..", "public", "loading.html"), "utf8");
const TAURI = path.join(HERE, "..", "..", "tauri", "src-tauri", "src");
const RUST = ["runtime/managed.rs", "backend/process.rs"]
  .map((f) => readFileSync(path.join(TAURI, f), "utf8"))
  .join("\n");

type Stage = { re: RegExp; download: boolean };
const STAGES: Stage[] = new Function(
  `return ${PAGE.match(/const STAGES = (\[[\s\S]*?\]);/)![1]}`,
)();

/** Every message, as the shell sends it, and the 1-based stage it is. */
const MESSAGES: [string, number, string][] = [
  ["Preparing the igni backend…", 1, "Preparing the igni backend…"],
  ["Downloading uv (one-time, ~25 MB)…", 2, "Downloading uv (one-time, ~25 MB)…"],
  ["Refreshing managed venv…", 2, "Refreshing managed venv…"],
  ["Installing Python 3.12 (one-time)…", 3, "Installing Python {PYTHON_VERSION} (one-time)…"],
  ["Creating backend venv…", 4, "Creating backend venv…"],
  ["Installing igni-core (one-time)…", 5, "Installing igni-core (one-time)…"],
  ["Updating igni-core…", 5, "Updating igni-core…"],
  ["Checking igni's decision model (~1.7 GB on first install)…", 6, "Checking igni's decision model (~1.7 GB on first install)…"],
  ["Starting the igni backend…", 7, "Starting the igni backend…"],
];

function stageOf(text: string): number {
  return STAGES.findIndex((s) => s.re.test(text)) + 1;
}

describe("the loading page's stages", () => {
  it("has the seven stages the page counts", () => {
    expect(STAGES).toHaveLength(7);
  });

  for (const [text, stage, source] of MESSAGES) {
    it(`"${text}" is still what the shell sends, and is stage ${stage}`, () => {
      expect(RUST, "the shell no longer sends this message; update both").toContain(source);
      expect(stageOf(text)).toBe(stage);
    });
  }

  it("names no product by its old name", () => {
    expect(PAGE).not.toMatch(/ignite-ember|Ember backend|embedding model/i);
  });
});
