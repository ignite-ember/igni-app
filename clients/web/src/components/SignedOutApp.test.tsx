// @vitest-environment jsdom
/**
 * The sign-in dialog the wall opens is drawn over the wall, not under it.
 *
 * The wall is a full-window `position: fixed` layer at z-index 60, and the
 * dialog used the shared `.overlay` at 50. So after "Sign in" the dialog
 * with the fallback URL and Cancel sat behind the wall: Playwright reported
 * `<div class="wall"> intercepts pointer events` at Cancel, and a person
 * whose browser did not open had no URL to copy and no way out (R219).
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignedOutApp } from "./SignedOutApp";

afterEach(cleanup);

const THEME = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "theme.css"),
  "utf8",
);

/** The z-index a top-level rule for exactly `selector` declares. */
function zIndexOf(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(THEME);
  expect(rule, `theme.css has a rule for ${selector}`).not.toBeNull();
  const z = /z-index:\s*(\d+)/.exec(rule![1]);
  expect(z, `${selector} declares a z-index`).not.toBeNull();
  return Number(z![1]);
}

function client() {
  return {
    rpc: vi.fn(async () => ({})),
    onEvent: () => () => {},
    calls: { login: vi.fn(() => new Promise(() => {})) },
    cancelLogin: vi.fn(),
  } as never;
}

describe("the sign-in dialog over the wall", () => {
  it("is drawn in the layer above the wall", () => {
    const { container } = render(
      <SignedOutApp
        client={client()}
        panel={{ kind: "login", params: {} } as never}
        onSignIn={vi.fn()}
        onClosePanel={vi.fn()}
        onSignedIn={vi.fn()}
        onFailed={vi.fn()}
      />,
    );
    const overlay = container.querySelector(".overlay");
    expect(overlay).not.toBeNull();
    expect(overlay!.classList.contains("overlay--over-wall")).toBe(true);
    expect(zIndexOf(".overlay--over-wall")).toBeGreaterThan(zIndexOf(".wall"));
  });
});
