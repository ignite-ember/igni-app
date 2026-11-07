import { describe, expect, it, vi } from "vitest";

import { RunSettingsSwitcher } from "./runSettingsSwitcher";

function setup(client: { switchModel?: unknown; handleCommand?: unknown }) {
  const view = { info: vi.fn(), error: vi.fn() };
  const refreshStatus = vi.fn(async () => {});
  const switcher = new RunSettingsSwitcher({ client: client as never, view, refreshStatus });
  return { switcher, view, refreshStatus };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("RunSettingsSwitcher.pickModel", () => {
  it("shows the backend's acknowledgement and refreshes the footer", async () => {
    const { switcher, view, refreshStatus } = setup({
      switchModel: vi.fn(async () => ({ type: "info", text: "switched" })),
    });
    await switcher.pickModel("m2");
    expect(view.info).toHaveBeenCalledWith("switched");
    expect(refreshStatus).toHaveBeenCalled();
  });

  it("reports a refused switch in the transcript", async () => {
    const { switcher, view, refreshStatus } = setup({
      switchModel: vi.fn(async () => {
        throw new Error("no such model");
      }),
    });
    await switcher.pickModel("nope");
    expect(view.error).toHaveBeenCalledWith("Error: no such model");
    expect(refreshStatus).not.toHaveBeenCalled();
  });
});

describe("RunSettingsSwitcher.pickMode", () => {
  it("does nothing for the mode already on", () => {
    const handleCommand = vi.fn(async () => ({}));
    setup({ handleCommand }).switcher.pickMode("plan", "plan");
    expect(handleCommand).not.toHaveBeenCalled();
  });

  it("sends the slash command that flips it, from the default when none is known", () => {
    const handleCommand = vi.fn(async () => ({}));
    setup({ handleCommand }).switcher.pickMode(undefined, "plan");
    expect(handleCommand).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected switch through the view", async () => {
    const { switcher, view } = setup({
      handleCommand: vi.fn(async () => {
        throw new Error("refused");
      }),
    });
    switcher.pickMode("default", "plan");
    await flush();
    expect(view.error).toHaveBeenCalledWith("Mode switch failed: refused");
  });
});
