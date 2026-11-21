// @vitest-environment jsdom
/**
 * The host bridge's half of the desktop's cloud switch: the commands it
 * invokes, the state push it hears, and what a window on the cloud side
 * no longer does with a path (design §5).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { Host } from "./host";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function desktop(invoke: Invoke, search = "") {
  window.history.replaceState(null, "", `/${search}`);
  window.__TAURI__ = { core: { invoke } };
  return new Host();
}

afterEach(() => {
  delete window.__TAURI__;
  delete window.__IGNI_HOST__;
  window.history.replaceState(null, "", "/");
});

describe("the switch's commands", () => {
  it("asks the shell for its state and passes each command's arguments", async () => {
    const invoke = vi.fn<Invoke>(async (cmd) => (cmd === "backend_state" ? { side: "cloud" } : null));
    const host = desktop(invoke);
    expect(await host.backendState()).toEqual({ side: "cloud" });
    await host.switchBackend("cloud");
    await host.cloudSignIn();
    host.cloudRetry();
    host.dismissBackendNotice();
    host.reportLocalActivity({ session_id: "s1", runs: 1, approvals: 0 });
    await host.accountRpc("get_cloud_plan");
    expect(invoke.mock.calls).toEqual([
      ["backend_state"],
      ["switch_backend", { side: "cloud" }],
      ["cloud_sign_in"],
      ["cloud_retry"],
      ["dismiss_backend_notice"],
      ["report_local_activity", { report: { session_id: "s1", runs: 1, approvals: 0 } }],
      ["account_rpc", { method: "get_cloud_plan", args: {} }],
    ]);
  });

  it("has no switch outside the desktop app", async () => {
    window.history.replaceState(null, "", "/");
    const host = new Host();
    expect(await host.backendState()).toBeNull();
    expect(host.accountRpc("get_cloud_plan")).toBeNull();
    await expect(host.switchBackend("cloud")).rejects.toThrow(/only the desktop app/);
    await expect(host.cloudSignIn()).rejects.toThrow(/only the desktop app/);
    host.cloudRetry();
    host.reportLocalActivity({ session_id: "", runs: 0, approvals: 0 });
  });

  it("reads a failed state call as none", async () => {
    const host = desktop(async () => {
      throw new Error("no such command");
    });
    expect(await host.backendState()).toBeNull();
  });

  it("hears the shell's pushes and stops when told", () => {
    const host = desktop(async () => null);
    const heard: unknown[] = [];
    const off = host.onBackendState((raw) => heard.push(raw));
    const push = (type: string, payload: unknown) =>
      window.dispatchEvent(new CustomEvent("igni-host", { detail: { type, payload } }));
    push("igni:backend-state", { state: "waking" });
    push("igni:menu", { id: "new_chat" });
    off();
    push("igni:backend-state", { state: "cloud_ready" });
    expect(heard).toEqual([{ state: "waking" }]);
  });
});

describe("a window on the cloud side", () => {
  it("opens no path on this computer and previews it instead", async () => {
    const openFile = vi.fn();
    const invoke = vi.fn<Invoke>(async () => null);
    const host = desktop(invoke, "?side=cloud&backend=cloud-0123456789ab");
    window.__IGNI_HOST__ = { openFile };
    const previewed: string[] = [];
    host.setPreviewFallback((p) => previewed.push(p));
    expect(host.onCloud).toBe(true);
    expect(host.canOpenNatively).toBe(false);
    expect(await host.openFile("/workspace/a.ts")).toBe(false);
    expect(openFile).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(previewed).toEqual(["/workspace/a.ts"]);
  });

  it("opens natively again on this computer", async () => {
    const openFile = vi.fn();
    const host = desktop(async () => null, "?side=local");
    window.__IGNI_HOST__ = { openFile };
    expect(host.onCloud).toBe(false);
    expect(host.canOpenNatively).toBe(true);
    expect(await host.openFile("/Users/me/a.ts")).toBe(true);
    expect(openFile).toHaveBeenCalledWith("/Users/me/a.ts");
  });
});
