// @vitest-environment jsdom
/**
 * The footer draws the side igni runs on whether or not the window's
 * backend has sent a status. A cloud-mode app started while its cloud
 * cannot be reached has no status at all (the window's socket is the
 * VM's), and that is exactly when "Cloud · offline" has to show (R691,
 * H1: the chip was missing for as long as the cloud was away).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { BackendSnapshot } from "../cloud/backendState";
import { shellSnapshot } from "../cloud/testing";
import { StatusLine } from "./StatusLine";

afterEach(() => cleanup());

/** Enough of a client for the footer's own chips: nothing ever answers. */
const quietClient = {
  rpc: () => new Promise(() => {}),
  onEvent: () => () => {},
};

function footer(backend: BackendSnapshot | null, status: unknown = null) {
  return render(
    <StatusLine
      status={status as never}
      sessionId="s1"
      client={quietClient as never}
      extensions={[]}
      notificationCounts={{} as never}
      pendingUpdate={null}
      onShowUpdate={() => {}}
      onOpen={() => {}}
      backend={backend}
    />,
  );
}

const offline = BackendSnapshot.parse(
  shellSnapshot({
    side: "cloud",
    state: "cloud_unreachable",
    reason: "network",
    mode: "cloud",
    switch_visible: false,
    can_use_local: false,
    backend_key: "cloud-cf82dcb539ec",
  }),
)!;

describe("the status line's backend chip", () => {
  it("says Cloud · offline while the cloud window has no connection and no status", () => {
    const { container } = footer(offline);
    const chip = container.querySelector(".backend-chip");
    expect(chip?.textContent).toBe("Cloud · offline");
    expect(chip?.className).toContain("tone-bad");
  });

  it("draws it once, beside the group, once a status has arrived", () => {
    const ready = BackendSnapshot.parse(shellSnapshot({ side: "cloud", state: "cloud_ready", mode: "cloud" }))!;
    const { container } = footer(ready, { context_tokens: 10, max_context: 100 });
    const chips = container.querySelectorAll(".backend-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("Cloud");
  });

  it("draws nothing for a shell that hides the chip, status or not", () => {
    const hidden = BackendSnapshot.parse(shellSnapshot({ mode: "local", chip_visible: false, switch_visible: false }))!;
    const { container } = footer(hidden);
    expect(container.querySelector(".backend-chip")).toBeNull();
  });

  it("draws nothing outside the desktop app", () => {
    const { container } = footer(null);
    expect(container.querySelector(".backend-chip")).toBeNull();
  });
});
