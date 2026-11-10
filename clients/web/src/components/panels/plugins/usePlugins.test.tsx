// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { InstalledPlugins } from "./installedPlugin";
import { MarketplaceCatalog } from "./marketplace";
import { PluginAction } from "./pluginAction";
import type { PluginsApi } from "./pluginsApi";
import type { ActionResult } from "./pluginWire";
import { usePlugins } from "./usePlugins";

afterEach(cleanup);

function fakeApi(over: Partial<Record<keyof PluginsApi, unknown>> = {}) {
  return {
    installed: vi.fn(async () => ({ ok: true, value: InstalledPlugins.parse([{ name: "lint", enabled: true }]) })),
    catalog: vi.fn(async () => ({ ok: true, value: MarketplaceCatalog.parse([]) })),
    install: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
    setEnabled: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
    remove: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
    addMarketplace: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
    removeMarketplace: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
    refreshMarketplaces: vi.fn(async (): Promise<ActionResult> => ({ ok: true })),
    ...over,
  };
}

function mount(api: ReturnType<typeof fakeApi>) {
  const hook = renderHook(() => usePlugins(api as unknown as PluginsApi));
  return hook;
}

describe("usePlugins", () => {
  it("reads both lists on mount", async () => {
    const api = fakeApi();
    const hook = mount(api);
    await waitFor(() => expect(hook.result.current.catalog).not.toBeNull());
    expect(hook.result.current.installed?.has("lint")).toBe(true);
    expect(hook.result.current.error).toBeNull();
  });

  it("shows the installed list's failure and an empty list; a catalog failure reads as none", async () => {
    const api = fakeApi({
      installed: vi.fn(async () => ({ ok: false, reason: "backend gone" })),
      catalog: vi.fn(async () => ({ ok: false, reason: "also gone" })),
    });
    const hook = mount(api);
    await waitFor(() => expect(hook.result.current.catalog).not.toBeNull());
    expect(hook.result.current.error).toEqual({ reason: "backend gone" });
    expect(hook.result.current.installed?.count).toBe(0);
    expect(hook.result.current.catalog?.marketCount).toBe(0);
  });

  it("marks one plugin busy while its toggle runs, then re-reads the lists", async () => {
    let finish: (r: ActionResult) => void = () => {};
    const api = fakeApi({ setEnabled: vi.fn(() => new Promise<ActionResult>((r) => (finish = r))) });
    const hook = mount(api);
    await waitFor(() => expect(hook.result.current.installed).not.toBeNull());
    const lint = hook.result.current.installed!.find("lint")!;
    act(() => hook.result.current.toggle(lint));
    expect(api.setEnabled).toHaveBeenCalledWith("lint", false);
    expect(hook.result.current.isRunning(PluginAction.plugin("lint"))).toBe(true);
    expect(hook.result.current.isRunning(PluginAction.plugin("other"))).toBe(false);
    await act(async () => finish({ ok: true }));
    expect(hook.result.current.isRunning(PluginAction.plugin("lint"))).toBe(false);
    expect(api.installed).toHaveBeenCalledTimes(2);
  });

  it("runs onDone only when the change succeeds, and shows the reason when it fails", async () => {
    const api = fakeApi({
      addMarketplace: vi.fn(async (url: string): Promise<ActionResult> =>
        url === "bad" ? { ok: false, reason: "git error: not a repository" } : { ok: true },
      ),
    });
    const hook = mount(api);
    await waitFor(() => expect(hook.result.current.catalog).not.toBeNull());
    const cleared = vi.fn();
    await act(async () => hook.result.current.addMarketplace("bad", cleared));
    expect(cleared).not.toHaveBeenCalled();
    expect(hook.result.current.error).toEqual({ reason: "git error: not a repository" });
    await act(async () => hook.result.current.addMarketplace("good", cleared));
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(hook.result.current.error).toBeNull();
  });

  it("installs a catalog plugin from its source, and a typed ref with its own busy flag", async () => {
    let finish: (r: ActionResult) => void = () => {};
    const api = fakeApi({ install: vi.fn(() => new Promise<ActionResult>((r) => (finish = r))) });
    const hook = mount(api);
    await waitFor(() => expect(hook.result.current.catalog).not.toBeNull());
    const done = vi.fn();
    act(() => hook.result.current.installRef("github.com/acme/x", done));
    expect(api.install).toHaveBeenCalledWith("github.com/acme/x");
    expect(hook.result.current.installingRef).toBe(true);
    expect(hook.result.current.refreshing).toBe(false);
    await act(async () => finish({ ok: true }));
    expect(done).toHaveBeenCalled();
    expect(hook.result.current.installingRef).toBe(false);
  });
});
