/**
 * Every backend the suite starts shares one Hugging Face cache.
 *
 * A chat message makes the backend ask its decisions service (Laya) how the
 * message feels, and the service downloads its model (~800 MB) into its
 * Hugging Face cache. That cache used to be the test's own temp home, so a
 * full run downloaded the model once per test: 68 homes, ~54 GB, and a full
 * disk. The fixture now points every backend at ``HF_CACHE``; this spec holds
 * it there.
 */

import { expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { HF_CACHE, REPO_ROOT, test, VENV_PYTHON } from "./fixtures/live-be";

const LAYA = path.join(HF_CACHE, "hub", "models--convaiinnovations--laya");
const READY = /Message (Ember|igni)/;

/** Whether igni-core's venv has the decisions service's model library. */
function hasLaya(): boolean {
  try {
    execFileSync(VENV_PYTHON, ["-c", "import laya"], { cwd: REPO_ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test.describe.configure({ timeout: 240_000 });

test(
  "the decisions model goes to the shared cache, never the test's home",
  { tag: "@needs-decisions" },
  async ({ page, liveBe }) => {
    test.skip(!hasLaya(), "igni-core's venv has no igni-core[decisions] (uv sync --all-extras)");
    expect(liveBe.home).not.toBeNull();
    const ownCache = path.join(liveBe.home as string, ".cache", "huggingface");

    // Laya's answer comes back as a ``user_sentiment`` push: proof the model
    // loaded, from wherever its cache is.
    let answered = false;
    page.on("websocket", (ws) =>
      ws.on("framereceived", ({ payload }) => {
        if (String(payload).includes('"user_sentiment"')) answered = true;
      }),
    );
    await page.goto(`/?ws=${encodeURIComponent(liveBe.wsUrl)}`);
    const editor = page.locator(".composer-editable");
    await expect(editor).toHaveAttribute("data-placeholder", READY, { timeout: 60_000 });
    await editor.click();
    await editor.fill("thank you so much, this is great work");
    await editor.press("Enter");

    await expect.poll(() => answered, { timeout: 150_000 }).toBe(true);
    expect(fs.existsSync(LAYA)).toBe(true);
    expect(fs.existsSync(ownCache)).toBe(false);
  },
);
