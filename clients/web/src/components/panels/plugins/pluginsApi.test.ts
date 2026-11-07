import { describe, expect, it, vi } from "vitest";

import { PluginsApi } from "./pluginsApi";

function apiWith(answer: (method: string, args: Record<string, unknown>) => unknown) {
  const rpc = vi.fn(async (method: string, args: Record<string, unknown> = {}) =>
    answer(method, args),
  );
  return { api: new PluginsApi({ rpc } as never), rpc };
}

describe("PluginsApi", () => {
  it("sends each mutation with its arguments", async () => {
    const { api, rpc } = apiWith(() => null);
    await api.install("github.com/acme/x");
    await api.setEnabled("quiet", true);
    await api.remove("quiet");
    await api.removeMarketplace("acme");
    await api.refreshMarketplaces();
    expect(rpc.mock.calls).toEqual([
      ["install_plugin", { ref: "github.com/acme/x" }],
      ["set_plugin_enabled", { name: "quiet", enabled: true }],
      ["remove_plugin", { name: "quiet" }],
      ["remove_marketplace", { name: "acme" }],
      ["refresh_marketplaces", { name: null }],
    ]);
  });

  it("turns a rejected call into a Failure with the bare reason", async () => {
    const { api } = apiWith(() => {
      throw new Error("git clone failed");
    });
    expect(await api.install("x")).toEqual({ ok: false, reason: "git clone failed" });
    expect(await api.installed()).toEqual({ ok: false, reason: "git clone failed" });
  });

  it("reads add_marketplace's failure text as a Failure", async () => {
    const { api, rpc } = apiWith((_m, args) =>
      args.url === "bad" ? { text: "git error: not a repository" } : { text: "Added acme" },
    );
    expect(await api.addMarketplace("good")).toEqual({ ok: true });
    expect(await api.addMarketplace("bad")).toEqual({
      ok: false,
      reason: "git error: not a repository",
    });
    expect(rpc.mock.calls[0]).toEqual(["add_marketplace", { url: "good" }]);
  });

  it("previews a catalog source with no subdir", async () => {
    const { api, rpc } = apiWith(() => ({ root_path: "/r", readme: "# hi", agents: [{ name: "a" }] }));
    const r = await api.preview("https://x/plugins.git [lint]", "stable");
    expect(rpc.mock.calls[0]).toEqual([
      "preview_plugin",
      { source: "https://x/plugins.git [lint]", branch: "stable", subdir: null },
    ]);
    expect(r.ok && r.value.parts.agents.map((a) => a.name)).toEqual(["a"]);
    expect(r.ok && r.value.isEmpty).toBe(false);
  });

  it("gives a rejected or in-band contents error as the same Failure", async () => {
    const rejecting = apiWith(() => {
      throw new Error("repository not found");
    }).api;
    expect(await rejecting.preview("s", null)).toEqual({ ok: false, reason: "repository not found" });
    const inBand = apiWith(() => ({ name: "x", error: "plugin not found" })).api;
    expect(await inBand.contents("x")).toEqual({ ok: false, reason: "plugin not found" });
  });

  it("reads the installed list, skipping rows without a name", async () => {
    const { api } = apiWith(() => [{ name: "quiet", pin: "0123456789abcdef", has_hooks: true }, {}]);
    const r = await api.installed();
    expect(r.ok && r.value.count).toBe(1);
    const quiet = r.ok ? r.value.find("quiet") : undefined;
    expect(quiet?.shortPin).toBe("01234567");
    expect(quiet?.capabilities).toEqual(["hooks"]);
  });
});
