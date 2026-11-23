// @vitest-environment jsdom
/**
 * The composer dock draws where igni runs — a menu to switch when the
 * group offers both sides, a read-only label when it does not, so the
 * person always sees which side was chosen. A cloud window whose cloud
 * cannot be reached has no status at all, and that is exactly when
 * "Cloud · offline" has to show (R691, H1).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BackendSnapshot } from "../cloud/backendState";
import { shellSnapshot } from "../cloud/testing";
import { ComposerDock } from "./ComposerDock";

afterEach(() => cleanup());

function dock(backend: BackendSnapshot | null) {
  return render(
    <ComposerDock backend={backend} projectDir="/work" onPickProject={() => {}} sessionId="s1" status={null} />,
  );
}

describe("the composer dock's environment control", () => {
  it("offers the switch when the group allows both sides", () => {
    // Default snapshot: local_and_cloud, switch visible.
    const backend = BackendSnapshot.parse(shellSnapshot())!;
    dock(backend);
    fireEvent.click(screen.getByTitle("Where igni runs"));
    expect(screen.getByRole("radiogroup", { name: "Where igni runs" })).toBeTruthy();
  });

  it("shows the side read-only when there is no choice", () => {
    const backend = BackendSnapshot.parse(
      shellSnapshot({ mode: "local", switch_visible: false, chip_visible: false }),
    )!;
    const { container } = dock(backend);
    expect(container.querySelector(".dock-static")?.textContent).toContain("This computer");
    // No menu to open.
    expect(screen.queryByTitle("Where igni runs")).toBeNull();
  });

  it("still shows Cloud · offline read-only while the cloud is away", () => {
    const backend = BackendSnapshot.parse(
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
    const { container } = dock(backend);
    expect(container.querySelector(".dock-static")?.textContent).toContain("Cloud · offline");
  });

  it("draws no environment control outside the desktop app", () => {
    const { container } = dock(null);
    expect(container.querySelector(".dock-static")).toBeNull();
    expect(screen.queryByTitle("Where igni runs")).toBeNull();
  });

  it("opens the folder picker from the dock", () => {
    const onPick = vi.fn();
    render(
      <ComposerDock backend={null} projectDir="/work/app" onPickProject={onPick} sessionId="s1" status={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /app/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open folder/ }));
    expect(onPick).toHaveBeenCalledOnce();
  });
});

describe("the composer dock's mode chip", () => {
  function dockWithMode(onPickMode: (m: never) => void) {
    return render(
      <ComposerDock
        backend={null}
        projectDir="/work"
        onPickProject={() => {}}
        sessionId="s1"
        status={null}
        permissionMode="acceptEdits"
        onPickMode={onPickMode as never}
      />,
    );
  }

  it("shows the current mode and switches to another", () => {
    const onPickMode = vi.fn();
    const { container } = dockWithMode(onPickMode);
    const trigger = container.querySelector(".composer-mode") as HTMLButtonElement;
    expect(trigger.textContent).toContain("Accept edits");

    fireEvent.click(trigger);
    const items = Array.from(container.querySelectorAll('[role="menuitem"]'));
    expect(items.map((i) => i.querySelector(".cmd")!.textContent)).toEqual([
      "Execute",
      "Plan",
      "Accept edits",
      "Auto",
    ]);

    // Picking the mode already in force is not a change.
    fireEvent.click(items[2] as HTMLElement);
    expect(onPickMode).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.click(container.querySelectorAll('[role="menuitem"]')[1] as HTMLElement);
    expect(onPickMode).toHaveBeenCalledWith("plan");
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });
});
